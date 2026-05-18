export type AgentMode = "exec" | "interactive";
export type PermissionPolicy = "ask" | "safe-auto" | "yolo";
export type AgentLocale = "en" | "ja";

export type Agent = {
  id: string;
  name: string;
  type: "claude" | "codex" | "grok" | "gemini" | "custom";
  mode?: AgentMode;
  permissionPolicy?: PermissionPolicy;
  command: string;
  args?: string[];
  workingDirectory: string;
  role: string;
  systemPrompt: string;
  status: "stopped" | "starting" | "running" | "error";
};

export type GraphNode = {
  id: string;
  agentId: string;
  position: {
    x: number;
    y: number;
  };
  isRoot: boolean;
};

export type GraphEdge = {
  id: string;
  source: string;
  target: string;
};

export type Task = {
  id: string;
  title: string;
  body: string;
  rootAgentId: string;
  status: "pending" | "running" | "completed" | "failed";
  createdAt: string;
  updatedAt: string;
};

export type Message = {
  id: string;
  taskId: string;
  from: "user" | string;
  to: string;
  body: string;
  createdAt: string;
};

export type AgentHistoryEntry = {
  taskId: string;
  receivedBody: string;
  responseLastMessage: string;
  emittedDispatches: { to: string; body: string }[];
  at: string;
  elapsedMs: number;
};

export type AgentSummary = {
  agentId: string;
  totalRuns: number;
  recentEntries: AgentHistoryEntry[];
};

export type DispatchEdge = {
  taskId: string;
  from: string;
  to: string;
  body: string;
  at: string;
};

export type TaskState = {
  taskId: string;
  title: string;
  originalBody: string;
  rootAgentId: string;
  dispatchHistory: DispatchEdge[];
  status: "running" | "completed" | "failed";
  createdAt: string;
};

export type GraphSnapshotForContext = {
  nodes: Array<{ agentId: string; name: string; role: string; isRoot: boolean }>;
  edges: Array<{ source: string; target: string }>;
};

export type ContextSnapshot = {
  taskState: TaskState | null;
  projectSummary: string;
  agentSummary: AgentSummary | null;
  graph: GraphSnapshotForContext;
  locale?: AgentLocale;
};

export type AgentRunRequest = {
  agentId: string;
  body: string;
  taskId: string;
  context: ContextSnapshot;
};

export type AgentRunResult =
  | { ok: true; lastMessage: string; exitCode: number; elapsedMs: number }
  | { ok: false; error: string };

export type PermissionRequestEvent = {
  requestId: string;
  agentId: string;
  agentName: string;
  toolName: string;
  input: unknown;
};

export type PermissionDecision = {
  allowed: boolean;
  reason?: string;
};

export type ToolCategory = "required" | "optional";

export type ToolInfo = {
  name: string;
  category: ToolCategory;
  available: boolean;
  version: string | null;
  why: string;
  install: {
    darwin: string;
    win32: string;
    linux: string;
  };
  autoInstall: { command: string; args: string[] } | null;
};

export type SetupCheckResult = {
  platform: "darwin" | "win32" | "linux" | string;
  tools: ToolInfo[];
};

export type InstallEvent =
  | { type: "stdout"; chunk: string }
  | { type: "stderr"; chunk: string }
  | { type: "exit"; code: number | null };

export type InstallProgress = {
  toolName: string;
  event: InstallEvent;
};

export type InstallResult =
  | { ok: true; alreadyInstalled?: boolean; exitCode?: number | null }
  | { ok: false; error: string };

// IPC 契約 — Pane2(frontend) と Pane3(backend) はこれをimportして使う
export type IpcChannels = {
  "mao:agent:list": () => Promise<Agent[]>;
  "mao:agent:save": (agent: Agent) => Promise<Agent>;
  "mao:agent:delete": (id: string) => Promise<void>;
  "mao:agent:run": (request: AgentRunRequest) => Promise<AgentRunResult>;
  "mao:agent:abort": (agentId: string) => Promise<boolean>;
  "mao:agent:abortAll": () => Promise<boolean>;
  "mao:agent:loadSummary": (agentId: string) => Promise<AgentSummary | null>;
  "mao:agent:appendHistory": (agentId: string, entry: AgentHistoryEntry) => Promise<void>;
  "mao:project:loadSummary": () => Promise<string>;
  "mao:project:saveSummary": (text: string) => Promise<void>;
  "mao:graph:load": () => Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }>;
  "mao:graph:save": (graph: { nodes: GraphNode[]; edges: GraphEdge[] }) => Promise<void>;
  "mao:task:create": (task: Task) => Promise<Task>;
  "mao:task:list": () => Promise<Task[]>;
  "mao:pty:spawn": (agentId: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  "mao:pty:write": (agentId: string, data: string) => Promise<void>;
  "mao:pty:kill": (agentId: string) => Promise<void>;
  "mao:log:append": (agentId: string, data: string) => Promise<void>;
  "mao:permission:respond": (requestId: string, decision: PermissionDecision) => Promise<boolean>;
  "mao:tty:getUrl": () => Promise<string | null>;
  "mao:tmux:selectWindow": (agentId: string) => Promise<boolean>;
  "mao:setup:check": () => Promise<SetupCheckResult>;
  "mao:setup:install": (toolName: string) => Promise<InstallResult>;
  "mao:setup:installCancel": (toolName: string) => Promise<boolean>;
};

export type PtyDataEvent = { agentId: string; data: string };
export type PtyStatusEvent = { agentId: string; status: Agent["status"] };
