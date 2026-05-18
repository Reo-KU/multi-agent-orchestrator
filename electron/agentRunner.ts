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
import { stripAnsi } from "../src/utils/stripAnsi";
import { ensureMaoGitignore } from "./workspaceGuard";

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

const sanitizeDispatchMarkers = (value: string): string =>
  value.replace(/\[TO:/gi, "[TO_PRIOR:");

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
  fanOutNote: (n: number) => string;
  dispatchInstruction: string;
  fileBasedTaskIntro: (args: {
    taskSpecRelative: string;
    signalToken: string;
    signalLogRelative: string;
  }) => string;
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
  fanOutNote: (n) =>
    `上記 ${n} 名の子エージェントが全員あなたの dispatch を待っています。タスクが分配可能なら全員に並行で「[TO: <child-agent>] 改行 <本文>」を出してください。`,
  dispatchInstruction:
    "子エージェントへ配送する場合、stdout に「[TO: <child-agent>] 改行 <本文>」の形式で出力してください (<child-agent> は上記の直接の子エージェント一覧から実名に置き換える)。\n" +
    "**複数の子エージェントに並行配送する場合は、子の数だけブロックを順に並べて出力してください。** " +
    "各ブロックは独立した dispatch として扱われ、すべて並列に実行されます。\n" +
    "ユーザータスクに 'n に合わせて' のようなパラメトリック表現があれば、上記の直接の子エージェント一覧の **全員** にパラメータを割り当てて 1 人 1 ブロックずつ出してください。",
  fileBasedTaskIntro: ({ taskSpecRelative, signalToken }) =>
    `次のタスクを実装してください。仕様は ${taskSpecRelative} にあります。\n` +
    `タスク完了時、必ず最後に **${signalToken}.flag という名前の空ファイルを .mao/ ディレクトリに作成** ` +
    `してください (Write / Edit ツール推奨。Bash の touch でも可。中身は空でよい)。\n` +
    `フルパス例: \`.mao/${signalToken}.flag\`\n`
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
  fanOutNote: (n) =>
    `All ${n} child agents above are waiting. If the task can be split, emit "[TO: <child-agent>] newline <body>" once per child in parallel.`,
  dispatchInstruction:
    'To dispatch to a child agent, write "[TO: <child-agent>] newline <body>" on stdout, replacing <child-agent> with a real name from the Direct child agents list above.\n' +
    "**When dispatching to multiple children in parallel, output one block per child, in sequence.** " +
    "Each block is treated as an independent dispatch and all dispatches run in parallel.\n" +
    "If the user task uses parametric phrasing like 'for each worker n', assign the parameter to **every** child agent listed above and emit one block per child.",
  fileBasedTaskIntro: ({ taskSpecRelative, signalToken }) =>
    `Please process the next task. The spec is at ${taskSpecRelative}\n` +
    `When done, **create an empty file named ${signalToken}.flag in the .mao/ directory** ` +
    `(prefer your Write/Edit tool; touch via Bash also works; content can be empty).\n` +
    `Path: \`.mao/${signalToken}.flag\`\n`
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
  prompt: string,
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
        prompt
      ],
      captureStrategy: "file",
      writePromptToStdin: false
    };
  }

  if (mode === "claude" || mode === "grok" || mode === "gemini") {
    return {
      args: ["-p", ...flatExtraArgs, prompt],
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
  const fanOutHint =
    directChildren.length >= 2
      ? `\n> ${t.fanOutNote(directChildren.length)}\n`
      : "";

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
    fanOutHint,
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
        `- task ${entry.taskId.slice(-6)}: ${t.receivedLabel}="${sanitizeDispatchMarkers(
          truncate(entry.receivedBody, 60)
        )}" ${t.responseLabel}="${sanitizeDispatchMarkers(
          truncate(entry.responseLastMessage, 60)
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

async function rotateSignalsIfLarge(signalLogPath: string): Promise<void> {
  try {
    const stat = await fs.stat(signalLogPath);
    if (stat.size > 100 * 1024) {
      const archive = `${signalLogPath}.${Date.now()}.bak`;
      await fs.move(signalLogPath, archive, { overwrite: false }).catch(() => undefined);
    }
  } catch {
    // The signal log may not exist yet.
  }
}

const buildExecLeafPrompt = (locale: AgentLocale, taskBody: string): string => {
  if (locale === "ja") {
    return `次のタスクを実装してください。応答は stdout に直接出力してください。\n\n----\n${taskBody}`;
  }
  return `Please process the next task. Print your answer to stdout.\n\n----\n${taskBody}`;
};

const buildExecBossInlinePrompt = (
  locale: AgentLocale,
  agent: Agent,
  ctx: ContextSnapshot,
  taskBody: string
): string => {
  // 子持ち agent への inline dispatcher prompt — spec file を読まず、必要情報を全部 prompt に直接含める
  const t = getPromptStrings(locale);
  const graphIntro = buildGraphIntro(agent, ctx.graph, t);
  const directChildren = (ctx.graph.edges ?? [])
    .filter((edge) => edge.source === agent.id)
    .map((edge) => ctx.graph.nodes.find((node) => node.agentId === edge.target))
    .filter((node): node is NonNullable<typeof node> => Boolean(node));
  const childNames = directChildren.map((n) => n.name).join(", ");

  if (locale === "ja") {
    return (
      `あなたは MAO の dispatcher です。あなたから線が出ている直接の子エージェントは以下の ${directChildren.length} 名です:\n` +
      `  ${childNames}\n\n` +
      `あなたの応答は以下の形式の **stdout テキスト出力のみ** にしてください。それ以外のツール (Bash / Write / Read / Edit / Spawn / Apps / MCP) は **一切使用しないこと**:\n` +
      `\n` +
      `[TO: <子の名前>]\n` +
      `<その子に割り当てる本文>\n` +
      `\n` +
      `[TO: <別の子の名前>]\n` +
      `<その子に割り当てる本文>\n` +
      `\n` +
      `...(子の数だけ繰り返す)\n` +
      `\n` +
      `--- 重要 ---\n` +
      `- <子の名前> 部分は、上記の実名 (${childNames}) に必ず置き換えてください。"<child-agent>" などのプレースホルダーをそのまま使わないでください。\n` +
      `- 完了 flag や touch、ファイル作成は不要です。stdout に上記ブロックを出力したら、それで処理は完了です。\n` +
      `- もし「自分でやった方が早い」と思っても、絶対に自分でやらないでください。あなたが配送をスキップすると、4 名の子エージェントが何もせず待ち続けてシステム全体が止まります。\n` +
      `- ユーザータスクに 'worker の番号 n に応じて' のような並行配送のヒントがあれば、各子に番号を割り当ててパラメータを変えた本文を出してください。\n` +
      `\n` +
      `--- グラフ情報 (参考) ---\n` +
      `${graphIntro}\n` +
      `\n` +
      `--- ユーザーから受信した task body ---\n` +
      `${taskBody}\n`
    );
  }
  return (
    `You are the MAO dispatcher. Your direct children (${directChildren.length} agents) are:\n` +
    `  ${childNames}\n\n` +
    `Your response must be ONLY stdout text in this exact format. Do NOT use any tool (Bash / Write / Read / Edit / Spawn / Apps / MCP):\n` +
    `\n` +
    `[TO: <child-name>]\n` +
    `<body assigned to that child>\n` +
    `\n` +
    `[TO: <another-child-name>]\n` +
    `<body assigned to that child>\n` +
    `\n` +
    `... (repeat for each child)\n` +
    `\n` +
    `--- Important ---\n` +
    `- Replace <child-name> with the real names listed above (${childNames}). Do NOT leave the placeholder "<child-agent>" or similar as-is.\n` +
    `- No completion flag, no touch, no file creation. Once you have written the blocks to stdout, you are done.\n` +
    `- If you feel "I could do this faster myself", DO NOT. Skipping dispatch will leave ${directChildren.length} child agents waiting forever and the whole system will stall.\n` +
    `- If the user task hints at parametric fan-out (e.g., 'for each worker n'), assign numbers to each child accordingly.\n` +
    `\n` +
    `--- Graph context (for reference) ---\n` +
    `${graphIntro}\n` +
    `\n` +
    `--- User-supplied task body ---\n` +
    `${taskBody}\n`
  );
};

const prepareFilePassingTask = async (
  agent: Agent,
  req: AgentRunRequest,
  signalToken: string
): Promise<{
  shortInstruction: string;
  signalLogPath: string;
  taskSpecPath: string;
  maoDir: string;
}> => {
  const workingDirectory = path.resolve(agent.workingDirectory);
  const maoDir = path.join(workingDirectory, ".mao");
  await fs.ensureDir(maoDir);

  const dispatchId = signalToken.replace(/^MAO_DONE_/, "");
  const fileBase = `${req.taskId}_${dispatchId.slice(0, 8)}`;
  const taskSpecRelative = `.mao/${fileBase}.md`;
  const signalLogRelative = ".mao/signals.log";
  const taskSpecPath = path.join(maoDir, `${fileBase}.md`);
  const signalLogPath = path.join(maoDir, "signals.log");
  const t = getPromptStrings(req.context.locale);
  const signalReminder = t.fileBasedTaskIntro({
    taskSpecRelative,
    signalToken,
    signalLogRelative
  });
  // 仕様ファイル末尾にも完了 signal 指示を埋める。agent が PTY 直送文を忘れて
  // 仕様ファイルだけ読むケースで signal が echo されないのを防ぐ。
  const fullSpec = `${composePrompt(agent, req.body, req.context)}\n\n---\n${signalReminder}`;

  await rotateSignalsIfLarge(signalLogPath);
  await fs.writeFile(taskSpecPath, fullSpec, "utf8");
  await fs.ensureFile(signalLogPath);

  return {
    shortInstruction: signalReminder,
    signalLogPath,
    taskSpecPath,
    maoDir
  };
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
    console.info("[MAO agentRunner.run]", {
      agentId: agent.id,
      status: agent.status,
      mode: agent.mode ?? "exec"
    });

    if (!ALLOWED_COMMANDS.has(commandName)) {
      return { ok: false, error: `Command not in allowlist: ${commandName}` };
    }

    const workingDirectory = path.resolve(agent.workingDirectory);
    if (!(await fs.pathExists(workingDirectory))) {
      return { ok: false, error: `workingDirectory does not exist: ${workingDirectory}` };
    }
    await ensureMaoGitignore(workingDirectory);

    const tmpFile = join(tmpdir(), `mao_agent_${agent.id}_${randomBytes(6).toString("hex")}.txt`);
    const signalToken = `MAO_DONE_${randomUUID()}`;

    // exec モード: spec file 経由ではなく **prompt 本文に inline で全部含める**。
    // boss (子持ち) は dispatcher role-lock + 子の実名リスト + task body。
    // leaf (子無し) は通常の task prompt のみ。
    const hasChildren = (req.context.graph?.edges ?? []).some((edge) => edge.source === agent.id);
    const locale = req.context.locale ?? "ja";
    const shortInstruction = hasChildren
      ? buildExecBossInlinePrompt(locale, agent, req.context, req.body)
      : buildExecLeafPrompt(locale, req.body);
    // spec file は不要 (inline 化)。taskSpecPath は cleanup には使わない
    const taskSpecPath = "";

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
      shortInstruction,
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
          proc.write(`${shortInstruction}\x04`);
        }
      } catch (error) {
        void fs.remove(taskSpecPath).catch(() => undefined);
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

        try {
          await fs.remove(taskSpecPath);
        } catch {
          // Best effort cleanup.
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
    await ensureMaoGitignore(workingDirectory);

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
    const { shortInstruction, signalLogPath, taskSpecPath, maoDir } = await prepareFilePassingTask(agent, req, signalToken);

    try {
      this.interactiveBuffers.set(agent.id, "");
      this.activeInteractiveAgents.add(agent.id);
      this.emit("status", { agentId: agent.id, status: "running" });

      this.ptyBackend.write(agent.id, shortInstruction);
      await new Promise((resolve) => setTimeout(resolve, 600));
      this.ptyBackend.write(agent.id, "\r");

      const startedAt = Date.now();
      const timeoutMs = 5 * 60 * 1000;
      let signaledAt: number | null = null;

      // signal は agent が `.mao/<token>.flag` ファイルを作成することで通知される。
      // Write/Edit ツール経由なので permission ダイアログ無し、Bash echo にも非依存。
      const signalFlagPath = path.join(maoDir, `${signalToken}.flag`);

      while (Date.now() - startedAt < timeoutMs) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        if (this.abortedAgents.has(agent.id)) {
          break;
        }

        if (await fs.pathExists(signalFlagPath)) {
          signaledAt = Date.now();
          break;
        }

        // 後方互換: 旧 signals.log 経由の signal も拾う
        try {
          const content = await fs.readFile(signalLogPath, "utf8");
          if (content.includes(signalToken)) {
            signaledAt = Date.now();
            break;
          }
        } catch {
          // Keep polling.
        }
      }

      // flag ファイルは cleanup する (signals.log は後方互換のため残す)
      fs.remove(signalFlagPath).catch(() => undefined);

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
    } finally {
      this.activeInteractiveAgents.delete(agent.id);
      this.interactiveBuffers.delete(agent.id);
      await fs.remove(taskSpecPath).catch(() => undefined);
    }
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
