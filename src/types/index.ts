export type Agent = {
  id: string;
  name: string;
  type: "claude" | "codex" | "grok" | "custom";
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

// IPC 契約 — Pane2(frontend) と Pane3(backend) はこれをimportして使う
export type IpcChannels = {
  "mao:agent:list": () => Promise<Agent[]>;
  "mao:agent:save": (agent: Agent) => Promise<Agent>;
  "mao:agent:delete": (id: string) => Promise<void>;
  "mao:graph:load": () => Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }>;
  "mao:graph:save": (graph: { nodes: GraphNode[]; edges: GraphEdge[] }) => Promise<void>;
  "mao:task:create": (task: Task) => Promise<Task>;
  "mao:task:list": () => Promise<Task[]>;
  "mao:pty:spawn": (agentId: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  "mao:pty:write": (agentId: string, data: string) => Promise<void>;
  "mao:pty:kill": (agentId: string) => Promise<void>;
  "mao:log:append": (agentId: string, data: string) => Promise<void>;
};

export type PtyDataEvent = { agentId: string; data: string };
export type PtyStatusEvent = { agentId: string; status: Agent["status"] };
