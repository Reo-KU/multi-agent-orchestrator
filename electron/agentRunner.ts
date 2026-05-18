import { randomBytes, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import fs from "fs-extra";
import * as pty from "node-pty";
import type {
  Agent,
  AgentLocale,
  AgentMode,
  AgentRunRequest,
  AgentRunResult,
  ContextSnapshot,
  GraphSnapshotForContext,
  PermissionPolicy,
  PtyDataEvent,
  PtyStatusEvent
} from "../src/types";
import { TASK_SIGNALS_PATH } from "../src/utils/storage";
import { stripAnsi } from "../src/utils/stripAnsi";

type AgentRunnerEvents = {
  data: [PtyDataEvent];
  status: [PtyStatusEvent];
};

type CliMode = "codex" | "claude" | "grok" | "gemini" | "stdin-generic";
type CaptureStrategy = "file" | "stdout";
export type PtyBackend = {
  has(agentId: string): boolean;
  spawn(agent: Agent): { ok: true } | { ok: false; error: string };
  write(agentId: string, data: string): void;
  kill(agentId: string): boolean | void;
  killAll(): void;
  on(eventName: "data", listener: (event: PtyDataEvent) => void): unknown;
  on(eventName: "status", listener: (event: PtyStatusEvent) => void): unknown;
};

const ALLOWED_COMMANDS = new Set(["claude", "codex", "grok", "gemini", "sh", "bash", "zsh", "python", "python3", "node"]);

const truncate = (value: string, maxLength: number): string =>
  value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;

type PromptStrings = {
  projectInfo: string;
  recentHistory: string;
  receivedLabel: string;
  responseLabel: string;
  currentTaskContext: string;
  taskId: string;
  title: string;
  originalInstruction: string;
  dispatchesSoFar: string;
  receivedInstruction: string;
  responseRules: string;
  responseRuleLines: string[];
  yourPosition: string;
  youAre: (name: string, role: string) => string;
  roleUnset: string;
  descendantTree: string;
  directChildren: string;
  none: string;
  dispatchInstruction: string;
  signalHeader: string;
  signalIntro: string;
  signalNote1: string;
  signalNote2: string;
  signalNote3: string;
};

const promptStringsJa: PromptStrings = {
  projectInfo: "プロジェクト情報",
  recentHistory: "あなたの直近の応答履歴",
  receivedLabel: "受信",
  responseLabel: "応答",
  currentTaskContext: "現在のタスク文脈",
  taskId: "タスクID",
  title: "タイトル",
  originalInstruction: "当初指示 (ユーザーから)",
  dispatchesSoFar: "これまでの分配",
  receivedInstruction: "受信した指示",
  responseRules: "応答ルール",
  responseRuleLines: [
    "- 子エージェントへ転送する場合のみ [TO: <名前>]\\n<本文> 形式で出力",
    "- 末端タスクの場合は最小限の出力 (1単語〜1文)",
    "- codex 内部の Spawn / Codex Apps / MCP 機能は使わない",
    "- 「ツールがない」と言わない。stdout に [TO:] を出すこと自体が配送"
  ],
  yourPosition: "MAO グラフ上のあなたの位置",
  youAre: (name, role) => `あなたは ${name} です。役割: ${role}`,
  roleUnset: "役割未設定",
  descendantTree: "あなた以下の子孫ツリー",
  directChildren: "直接の子エージェント",
  none: "なし",
  dispatchInstruction: "子エージェントへ配送する場合は、stdout に [TO: <エージェント名>] の形式で出力してください。",
  signalHeader: "MAO 完了通知 (必須・厳守)",
  signalIntro: "上記タスクの応答が完了したら、必ず最後に以下を shell で1行だけ実行してください:",
  signalNote1: "このコマンドの実行を MAO はタスク完了の signal として検知します。",
  signalNote2: "実行しないと MAO は完了を検知できず、最大5分タイムアウト待ちになります。",
  signalNote3: "[TO: ...] ブロックがある場合は応答中に出力し、その後に上記の echo を出してください。"
};

const promptStringsEn: PromptStrings = {
  projectInfo: "Project Information",
  recentHistory: "Your recent response history",
  receivedLabel: "received",
  responseLabel: "response",
  currentTaskContext: "Current task context",
  taskId: "Task ID",
  title: "Title",
  originalInstruction: "Original instruction (from user)",
  dispatchesSoFar: "Dispatches so far",
  receivedInstruction: "Received instruction",
  responseRules: "Response rules",
  responseRuleLines: [
    "- Only output [TO: <name>]\\n<body> format when delegating to a child agent",
    "- For leaf tasks, output minimally (single word or single sentence)",
    "- Do not use codex's internal Spawn / Codex Apps / MCP features",
    '- Do not say "no tool available". Writing [TO:] to stdout *is* the dispatch.'
  ],
  yourPosition: "Your position in the MAO graph",
  youAre: (name, role) => `You are ${name}. Role: ${role}`,
  roleUnset: "role unset",
  descendantTree: "Your descendant tree",
  directChildren: "Direct child agents",
  none: "none",
  dispatchInstruction: "To dispatch to a child agent, write [TO: <agent-name>] on stdout.",
  signalHeader: "MAO completion signal (REQUIRED)",
  signalIntro: "When the task above is fully done, run this single shell command as your last action:",
  signalNote1: "MAO detects task completion via this exact command.",
  signalNote2: "Without it, MAO waits up to 5 minutes before timing out.",
  signalNote3: "If you have [TO: ...] blocks, output them during your response and then run the echo above."
};

const getPromptStrings = (locale: AgentLocale | undefined): PromptStrings =>
  (locale ?? "ja") === "en" ? promptStringsEn : promptStringsJa;

const getCommandName = (command: string): string => {
  const normalized = command.trim();
  const parts = normalized.split(/[\\/]/);
  return parts[parts.length - 1] ?? normalized;
};

const detectCliMode = (commandName: string): CliMode => {
  if (commandName === "codex") {
    return "codex";
  }

  if (commandName === "claude") {
    return "claude";
  }

  if (commandName === "grok") {
    return "grok";
  }

  if (commandName === "gemini") {
    return "gemini";
  }

  return "stdin-generic";
};

const flattenExtraArgs = (args: string[] | undefined): string[] =>
  (args ?? []).flatMap((arg) => arg.split(/\s+/)).filter((arg) => arg.length > 0);

const buildPolicyArgs = (mode: CliMode, agentMode: AgentMode, policy: PermissionPolicy): string[] => {
  if (policy === "safe-auto") {
    if (mode === "codex") {
      return ["--sandbox", "workspace-write"];
    }

    if (mode === "claude") {
      return ["--permission-mode", "acceptEdits"];
    }

    if (mode === "gemini") {
      return ["--approval-mode", "auto_edit"];
    }

    return [];
  }

  if (policy === "yolo") {
    if (mode === "codex") {
      return ["--dangerously-bypass-approvals-and-sandbox"];
    }

    if (mode === "claude") {
      return ["--dangerously-skip-permissions"];
    }

    if (mode === "gemini") {
      return ["--yolo"];
    }

    return [];
  }

  if (policy === "ask") {
    // codex のデフォルト approval_policy はゆるく、何もしないと TUI でも黙って実行される。
    // interactive モードのときだけ「全コマンド承認待ち」に強制し、sandbox は承認後の動作を妨げないよう
    // danger-full-access にする (sandbox 制限は yolo/safe-auto と直交的な保護なので、ask では承認に委ねる)。
    // exec モードは codex 自体が approval: never に固定されているため、ここで送ってもハングするだけで意味がない。
    if (mode === "codex" && agentMode === "interactive") {
      return ["-c", 'approval_policy="untrusted"', "--sandbox", "danger-full-access"];
    }
    // claude は MCP の --permission-prompt-tool 側で扱う (run() で別途注入)
    // gemini / grok / stdin-generic は CLI の TUI 既定に任せる
    return [];
  }

  return [];
};

const buildRunArgs = (
  mode: CliMode,
  workingDirectory: string,
  tmpFile: string,
  fullPrompt: string,
  flatExtraArgs: string[]
): { args: string[]; captureStrategy: CaptureStrategy; writePromptToStdin: boolean } => {
  if (mode === "codex") {
    return {
      args: [
        "exec",
        "--skip-git-repo-check",
        "--ephemeral",
        "-C",
        workingDirectory,
        "--output-last-message",
        tmpFile,
        ...flatExtraArgs,
        fullPrompt
      ],
      captureStrategy: "file",
      writePromptToStdin: false
    };
  }

  if (mode === "claude" || mode === "grok" || mode === "gemini") {
    return {
      args: ["-p", ...flatExtraArgs, fullPrompt],
      captureStrategy: "stdout",
      writePromptToStdin: false
    };
  }

  return {
    args: flatExtraArgs,
    captureStrategy: "stdout",
    writePromptToStdin: true
  };
};

const buildGraphIntro = (agent: Agent, graph: GraphSnapshotForContext, t: PromptStrings): string => {
  const ownNode = graph.nodes.find((node) => node.agentId === agent.id);
  if (!ownNode) {
    return "";
  }

  const nodeByAgentId = new Map(graph.nodes.map((node) => [node.agentId, node]));
  const childrenByAgentId = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const children = childrenByAgentId.get(edge.source) ?? [];
    children.push(edge.target);
    childrenByAgentId.set(edge.source, children);
  }

  const renderTree = (agentId: string, depth = 0, seen = new Set<string>()): string[] => {
    const node = nodeByAgentId.get(agentId);
    if (!node || seen.has(agentId)) {
      return [];
    }

    const nextSeen = new Set(seen);
    nextSeen.add(agentId);
    const indent = "  ".repeat(depth);
    const lines = [`${indent}- ${node.name} (${node.role || t.roleUnset})${node.isRoot ? " [root]" : ""}`];

    for (const childId of childrenByAgentId.get(agentId) ?? []) {
      lines.push(...renderTree(childId, depth + 1, nextSeen));
    }

    return lines;
  };

  const directChildren = (childrenByAgentId.get(agent.id) ?? [])
    .map((childId) => nodeByAgentId.get(childId))
    .filter((node): node is NonNullable<typeof node> => Boolean(node));

  const lines = [
    `## ${t.yourPosition}`,
    t.youAre(ownNode.name, ownNode.role || agent.role || t.roleUnset),
    "",
    `### ${t.descendantTree}`,
    ...renderTree(agent.id),
    "",
    `### ${t.directChildren}`,
    directChildren.length > 0
      ? directChildren.map((child) => `- ${child.name}: ${child.role || t.roleUnset}`).join("\n")
      : `- ${t.none}`,
    "",
    t.dispatchInstruction
  ];

  return lines.join("\n");
};

const composePrompt = (agent: Agent, body: string, ctx: ContextSnapshot): string => {
  const t = getPromptStrings(ctx.locale);
  const sections: string[] = [];
  const ownNode = ctx.graph.nodes.find((node) => node.agentId === agent.id);

  if (ownNode) {
    sections.push(buildGraphIntro(agent, ctx.graph, t));
  }

  if (ctx.projectSummary.trim().length > 0) {
    sections.push(`## ${t.projectInfo}\n${ctx.projectSummary.trim()}`);
  }

  if (ctx.agentSummary && ctx.agentSummary.recentEntries.length > 0) {
    const lines = [`## ${t.recentHistory}`];
    for (const entry of ctx.agentSummary.recentEntries.slice(-5)) {
      lines.push(
        `- task ${entry.taskId.slice(-6)}: ${t.receivedLabel}="${truncate(
          entry.receivedBody,
          60
        )}" ${t.responseLabel}="${truncate(
          entry.responseLastMessage,
          60
        )}"`
      );
    }
    sections.push(lines.join("\n"));
  }

  if (ctx.taskState) {
    const lines = [
      `## ${t.currentTaskContext}`,
      `- ${t.taskId}: ${ctx.taskState.taskId}`,
      `- ${t.title}: ${ctx.taskState.title}`,
      `- ${t.originalInstruction}: ${truncate(ctx.taskState.originalBody, 200)}`
    ];

    if (ctx.taskState.dispatchHistory.length > 0) {
      lines.push(`- ${t.dispatchesSoFar}:`);
      for (const dispatch of ctx.taskState.dispatchHistory) {
        const fromName = ctx.graph.nodes.find((node) => node.agentId === dispatch.from)?.name ?? dispatch.from;
        const toName = ctx.graph.nodes.find((node) => node.agentId === dispatch.to)?.name ?? dispatch.to;
        lines.push(`  - ${fromName} -> ${toName}: ${truncate(dispatch.body, 100)}`);
      }
    }

    sections.push(lines.join("\n"));
  }

  sections.push(`## ${t.receivedInstruction}`);
  sections.push(body);
  sections.push("");
  sections.push(`## ${t.responseRules}`);
  sections.push(...t.responseRuleLines);

  return sections.join("\n\n");
};

export declare interface AgentRunner {
  on<K extends keyof AgentRunnerEvents>(eventName: K, listener: (...args: AgentRunnerEvents[K]) => void): this;
  off<K extends keyof AgentRunnerEvents>(eventName: K, listener: (...args: AgentRunnerEvents[K]) => void): this;
  emit<K extends keyof AgentRunnerEvents>(eventName: K, ...args: AgentRunnerEvents[K]): boolean;
}

export class AgentRunner extends EventEmitter {
  private readonly activePtys = new Map<string, pty.IPty>();
  private readonly interactiveBuffers = new Map<string, string>();
  private readonly activeInteractiveAgents = new Set<string>();
  private readonly abortedAgents = new Set<string>();
  private ptyBackend: PtyBackend | null = null;
  private isPtyManagerSubscribed = false;
  private mcpPermissionPort = 0;

  setMcpPort(port: number): void {
    this.mcpPermissionPort = port;
  }

  setPtyManager(backend: PtyBackend): void {
    this.ptyBackend = backend;

    if (this.isPtyManagerSubscribed) {
      return;
    }

    this.isPtyManagerSubscribed = true;
    backend.on("data", ({ agentId, data }) => {
      const current = this.interactiveBuffers.get(agentId);
      if (current !== undefined) {
        this.interactiveBuffers.set(agentId, current + data);
      }
    });
  }

  async run(req: AgentRunRequest, agent: Agent): Promise<AgentRunResult> {
    const commandName = getCommandName(agent.command ?? "");
    if (!ALLOWED_COMMANDS.has(commandName)) {
      return { ok: false, error: `Command not in allowlist: ${commandName}` };
    }

    const workingDirectory = path.resolve(agent.workingDirectory);
    if (!(await fs.pathExists(workingDirectory))) {
      return { ok: false, error: `workingDirectory does not exist: ${workingDirectory}` };
    }

    const tmpFile = join(tmpdir(), `mao_agent_${agent.id}_${randomBytes(6).toString("hex")}.txt`);
    const fullPrompt = composePrompt(agent, req.body, req.context);
    const mode = detectCliMode(commandName);
    const policy = agent.permissionPolicy ?? "safe-auto";
    const policyArgs = buildPolicyArgs(mode, agent.mode ?? "exec", policy);
    const cleanupFiles: string[] = [];
    let extraEnv: Record<string, string> = {};
    let extraInjectedArgs: string[] = [];

    if (mode === "claude" && (agent.mode ?? "exec") === "exec" && policy === "ask") {
      const mcpConfigPath = join(tmpdir(), `mao_mcp_${agent.id}_${randomBytes(6).toString("hex")}.json`);
      const bridgePath = path.resolve(__dirname, "../../electron/mcpPermissionBridge.mjs");

      await fs.writeJson(
        mcpConfigPath,
        {
          mcpServers: {
            maoperm: {
              type: "stdio",
              command: "node",
              args: [bridgePath]
            }
          }
        },
        { spaces: 2 }
      );
      cleanupFiles.push(mcpConfigPath);

      extraInjectedArgs = [
        "--mcp-config",
        mcpConfigPath,
        "--permission-prompt-tool",
        "mcp__maoperm__approve_request"
      ];
      extraEnv = {
        MAO_PERM_PORT: String(this.mcpPermissionPort),
        MAO_AGENT_ID: agent.id,
        MAO_AGENT_NAME: agent.name
      };
    }

    const flatExtraArgs = flattenExtraArgs(agent.args);
    const combinedExtraArgs = [...policyArgs, ...extraInjectedArgs, ...flatExtraArgs];
    const { args, captureStrategy, writePromptToStdin } = buildRunArgs(
      mode,
      workingDirectory,
      tmpFile,
      fullPrompt,
      combinedExtraArgs
    );
    console.log(`[AgentRunner] ${agent.name} (mode=${mode}, policy=${policy}) args:`, args);

    this.emit("status", { agentId: agent.id, status: "running" });

    const startedAt = Date.now();
    return new Promise<AgentRunResult>((resolve) => {
      let proc: pty.IPty;
      let stdoutBuffer = "";

      try {
        proc = pty.spawn(agent.command, args, {
          cwd: workingDirectory,
          env: { ...(process.env as Record<string, string>), ...extraEnv },
          cols: 140,
          rows: 40
        });
        this.activePtys.set(agent.id, proc);

        if (writePromptToStdin) {
          proc.write(`${fullPrompt}\x04`);
        }
      } catch (error) {
        this.emit("status", { agentId: agent.id, status: "error" });
        resolve({ ok: false, error: error instanceof Error ? error.message : String(error) });
        return;
      }

      proc.onData((data) => {
        if (captureStrategy === "stdout") {
          stdoutBuffer += data;
        }

        this.emit("data", { agentId: agent.id, data });
      });

      proc.onExit(async ({ exitCode }) => {
        this.activePtys.delete(agent.id);
        this.abortedAgents.delete(agent.id);
        const elapsedMs = Date.now() - startedAt;
        let lastMessage = "";

        if (captureStrategy === "file") {
          try {
            lastMessage = await fs.readFile(tmpFile, "utf8");
          } catch {
            lastMessage = "";
          }
        } else {
          lastMessage = stripAnsi(stdoutBuffer).trim();
        }

        if (captureStrategy === "file") {
          try {
            await fs.remove(tmpFile);
          } catch {
            // Best effort cleanup.
          }
        }

        for (const filePath of cleanupFiles) {
          try {
            await fs.remove(filePath);
          } catch {
            // Best effort cleanup.
          }
        }

        this.emit("status", { agentId: agent.id, status: exitCode === 0 ? "stopped" : "error" });
        resolve({ ok: true, lastMessage, exitCode, elapsedMs });
      });
    });
  }

  async runInteractive(req: AgentRunRequest, agent: Agent): Promise<AgentRunResult> {
    if (!this.ptyBackend) {
      return { ok: false, error: "PTY backend not configured for AgentRunner" };
    }

    const commandName = getCommandName(agent.command ?? "");
    if (!ALLOWED_COMMANDS.has(commandName)) {
      return { ok: false, error: `Command not in allowlist: ${commandName}` };
    }

    const workingDirectory = path.resolve(agent.workingDirectory);
    if (!(await fs.pathExists(workingDirectory))) {
      return { ok: false, error: `workingDirectory does not exist: ${workingDirectory}` };
    }

    if (!this.ptyBackend.has(agent.id)) {
      const spawnResult = this.ptyBackend.spawn(agent);
      if (!spawnResult.ok) {
        return { ok: false, error: spawnResult.error };
      }

      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    const taskCallId = randomUUID();
    // 区切り文字を入れない単一トークン。エスケープに依存しないので printf/echo どちらでも壊れない。
    const signalToken = `MAO_DONE_${taskCallId}`;
    const t = getPromptStrings(req.context.locale);
    const basePrompt = composePrompt(agent, req.body, req.context);
    const signalInstruction = [
      "",
      `## ${t.signalHeader}`,
      t.signalIntro,
      "",
      `  echo "${signalToken}" >> "${TASK_SIGNALS_PATH}"`,
      "",
      t.signalNote1,
      t.signalNote2,
      t.signalNote3
    ].join("\n");
    const fullPrompt = `${basePrompt}\n\n${signalInstruction}`;

    this.interactiveBuffers.set(agent.id, "");
    this.activeInteractiveAgents.add(agent.id);
    this.emit("status", { agentId: agent.id, status: "running" });

    this.ptyBackend.write(agent.id, fullPrompt);
    await new Promise((resolve) => setTimeout(resolve, 600));
    this.ptyBackend.write(agent.id, "\r");

    const startedAt = Date.now();
    const timeoutMs = 5 * 60 * 1000;
    let signaledAt: number | null = null;

    while (Date.now() - startedAt < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (this.abortedAgents.has(agent.id)) {
        break;
      }

      try {
        const content = await fs.readFile(TASK_SIGNALS_PATH, "utf8");
        if (content.includes(signalToken)) {
          signaledAt = Date.now();
          break;
        }
      } catch {
        // Keep polling until timeout.
      }
    }

    const elapsedMs = Date.now() - startedAt;
    const wasAborted = this.abortedAgents.has(agent.id);
    this.abortedAgents.delete(agent.id);
    this.activeInteractiveAgents.delete(agent.id);
    const buffer = this.interactiveBuffers.get(agent.id) ?? "";
    this.interactiveBuffers.delete(agent.id);
    this.emit("status", { agentId: agent.id, status: "running" });

    if (!signaledAt) {
      if (wasAborted) {
        return { ok: false, error: `Aborted by user. Buffer length: ${buffer.length}` };
      }

      return {
        ok: false,
        error: `Timeout waiting for ${signalToken} after ${Math.round(
          elapsedMs / 1000
        )}s. Buffer length: ${buffer.length}`
      };
    }

    const cleanBuffer = stripAnsi(buffer);
    const signalIndex = cleanBuffer.lastIndexOf(signalToken);
    const lastMessage = (signalIndex > 0 ? cleanBuffer.slice(0, signalIndex) : cleanBuffer).trim();

    return {
      ok: true,
      lastMessage,
      exitCode: 0,
      elapsedMs
    };
  }

  write(agentId: string, data: string): boolean {
    const proc = this.activePtys.get(agentId);
    if (!proc) {
      return false;
    }

    proc.write(data);
    return true;
  }

  kill(agentId: string): boolean {
    const proc = this.activePtys.get(agentId);
    if (!proc) {
      return false;
    }

    proc.kill();
    this.activePtys.delete(agentId);
    return true;
  }

  abort(agentId: string): boolean {
    this.abortedAgents.add(agentId);
    return this.kill(agentId);
  }

  abortAll(): void {
    for (const agentId of this.activePtys.keys()) {
      this.abortedAgents.add(agentId);
    }

    for (const agentId of this.activeInteractiveAgents.values()) {
      this.abortedAgents.add(agentId);
    }

    this.killAll();
  }

  killAll(): void {
    for (const proc of this.activePtys.values()) {
      try {
        proc.kill();
      } catch {
        // Best effort shutdown.
      }
    }

    this.activePtys.clear();
  }
}
