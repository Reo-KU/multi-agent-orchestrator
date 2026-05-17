import type {
  Agent,
  AgentHistoryEntry,
  AgentRunRequest,
  AgentRunResult,
  AgentSummary,
  GraphEdge,
  GraphNode,
  PermissionDecision,
  PermissionRequestEvent,
  PtyDataEvent,
  PtyStatusEvent,
  Task
} from "./index";

type MaoApi = {
  agent: {
    list: () => Promise<Agent[]>;
    save: (agent: Agent) => Promise<Agent>;
    delete: (id: string) => Promise<void>;
    run: (request: AgentRunRequest) => Promise<AgentRunResult>;
    loadSummary: (agentId: string) => Promise<AgentSummary | null>;
    appendHistory: (agentId: string, entry: AgentHistoryEntry) => Promise<void>;
  };
  project: {
    loadSummary: () => Promise<string>;
    saveSummary: (text: string) => Promise<void>;
  };
  graph: {
    load: () => Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }>;
    save: (graph: { nodes: GraphNode[]; edges: GraphEdge[] }) => Promise<void>;
  };
  task: {
    create: (task: Task) => Promise<Task>;
    list: () => Promise<Task[]>;
  };
  pty: {
    spawn: (agentId: string) => Promise<{ ok: true } | { ok: false; error: string }>;
    write: (agentId: string, data: string) => Promise<void>;
    kill: (agentId: string) => Promise<void>;
  };
  log: {
    append: (agentId: string, data: string) => Promise<void>;
  };
  permission: {
    respond: (requestId: string, decision: PermissionDecision) => Promise<boolean>;
    onRequest: (callback: (event: PermissionRequestEvent) => void) => () => void;
  };
  onPtyData: (callback: (event: PtyDataEvent) => void) => () => void;
  onPtyStatus: (callback: (event: PtyStatusEvent) => void) => () => void;
};

declare global {
  interface Window {
    mao: MaoApi;
  }
}

export {};
