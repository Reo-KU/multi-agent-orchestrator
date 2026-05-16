import type { Agent, GraphEdge, GraphNode, PtyDataEvent, PtyStatusEvent, Task } from "./index";

type MaoApi = {
  agent: {
    list: () => Promise<Agent[]>;
    save: (agent: Agent) => Promise<Agent>;
    delete: (id: string) => Promise<void>;
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
  onPtyData: (callback: (event: PtyDataEvent) => void) => () => void;
  onPtyStatus: (callback: (event: PtyStatusEvent) => void) => () => void;
};

declare global {
  interface Window {
    mao: MaoApi;
  }
}

export {};
