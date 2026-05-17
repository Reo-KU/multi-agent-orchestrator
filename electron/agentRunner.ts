import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import fs from "fs-extra";
import * as pty from "node-pty";
import type {
  Agent,
  AgentRunRequest,
  AgentRunResult,
  ContextSnapshot,
  GraphSnapshotForContext,
  PermissionPolicy,
  PtyDataEvent,
  PtyStatusEvent
} from "../src/types";
import { stripAnsi } from "../src/utils/stripAnsi";

type AgentRunnerEvents = {
  data: [PtyDataEvent];
  status: [PtyStatusEvent];
};

type CliMode = "codex" | "claude" | "grok" | "gemini" | "stdin-generic";
type CaptureStrategy = "file" | "stdout";

const ALLOWED_COMMANDS = new Set(["claude", "codex", "grok", "gemini", "sh", "bash", "zsh", "python", "python3", "node"]);

const truncate = (value: string, maxLength: number): string =>
  value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;

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

const buildPolicyArgs = (mode: CliMode, policy: PermissionPolicy): string[] => {
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

const buildGraphIntro = (agent: Agent, graph: GraphSnapshotForContext): string => {
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
    const lines = [`${indent}- ${node.name} (${node.role || "role unset"})${node.isRoot ? " [root]" : ""}`];

    for (const childId of childrenByAgentId.get(agentId) ?? []) {
      lines.push(...renderTree(childId, depth + 1, nextSeen));
    }

    return lines;
  };

  const directChildren = (childrenByAgentId.get(agent.id) ?? [])
    .map((childId) => nodeByAgentId.get(childId))
    .filter((node): node is NonNullable<typeof node> => Boolean(node));

  const lines = [
    "## MAO グラフ上のあなたの位置",
    `あなたは ${ownNode.name} です。役割: ${ownNode.role || agent.role || "未設定"}`,
    "",
    "### あなた以下の子孫ツリー",
    ...renderTree(agent.id),
    "",
    "### 直接の子エージェント",
    directChildren.length > 0
      ? directChildren.map((child) => `- ${child.name}: ${child.role || "role unset"}`).join("\n")
      : "- なし",
    "",
    "子エージェントへ配送する場合は、stdout に [TO: <エージェント名>] の形式で出力してください。"
  ];

  return lines.join("\n");
};

const composePrompt = (agent: Agent, body: string, ctx: ContextSnapshot): string => {
  const sections: string[] = [];
  const ownNode = ctx.graph.nodes.find((node) => node.agentId === agent.id);

  if (ownNode) {
    sections.push(buildGraphIntro(agent, ctx.graph));
  }

  if (ctx.projectSummary.trim().length > 0) {
    sections.push(`## プロジェクト情報\n${ctx.projectSummary.trim()}`);
  }

  if (ctx.agentSummary && ctx.agentSummary.recentEntries.length > 0) {
    const lines = ["## あなたの直近の応答履歴"];
    for (const entry of ctx.agentSummary.recentEntries.slice(-5)) {
      lines.push(
        `- task ${entry.taskId.slice(-6)}: 受信="${truncate(entry.receivedBody, 60)}" 応答="${truncate(
          entry.responseLastMessage,
          60
        )}"`
      );
    }
    sections.push(lines.join("\n"));
  }

  if (ctx.taskState) {
    const lines = [
      "## 現在のタスク文脈",
      `- タスクID: ${ctx.taskState.taskId}`,
      `- タイトル: ${ctx.taskState.title}`,
      `- 当初指示 (ユーザーから): ${truncate(ctx.taskState.originalBody, 200)}`
    ];

    if (ctx.taskState.dispatchHistory.length > 0) {
      lines.push("- これまでの分配:");
      for (const dispatch of ctx.taskState.dispatchHistory) {
        const fromName = ctx.graph.nodes.find((node) => node.agentId === dispatch.from)?.name ?? dispatch.from;
        const toName = ctx.graph.nodes.find((node) => node.agentId === dispatch.to)?.name ?? dispatch.to;
        lines.push(`  - ${fromName} -> ${toName}: ${truncate(dispatch.body, 100)}`);
      }
    }

    sections.push(lines.join("\n"));
  }

  sections.push("## 受信した指示");
  sections.push(body);
  sections.push("");
  sections.push("## 応答ルール");
  sections.push("- 子エージェントへ転送する場合のみ [TO: <名前>]\\n<本文> 形式で出力");
  sections.push("- 末端タスクの場合は最小限の出力 (1単語〜1文)");
  sections.push("- codex 内部の Spawn / Codex Apps / MCP 機能は使わない");
  sections.push("- 「ツールがない」と言わない。stdout に [TO:] を出すこと自体が配送");

  return sections.join("\n\n");
};

export declare interface AgentRunner {
  on<K extends keyof AgentRunnerEvents>(eventName: K, listener: (...args: AgentRunnerEvents[K]) => void): this;
  off<K extends keyof AgentRunnerEvents>(eventName: K, listener: (...args: AgentRunnerEvents[K]) => void): this;
  emit<K extends keyof AgentRunnerEvents>(eventName: K, ...args: AgentRunnerEvents[K]): boolean;
}

export class AgentRunner extends EventEmitter {
  private readonly activePtys = new Map<string, pty.IPty>();
  private mcpPermissionPort = 0;

  setMcpPort(port: number): void {
    this.mcpPermissionPort = port;
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
    const policyArgs = buildPolicyArgs(mode, policy);
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
