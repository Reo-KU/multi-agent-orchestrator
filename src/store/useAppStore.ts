import { create } from "zustand";
import type { Agent, GraphEdge, GraphNode, Task } from "../types";
import { parseToBlocks, type ToBlock } from "../utils/parseToBlocks";

type TaskMode = "manual" | "auto";
type GraphSnapshot = { nodes: GraphNode[]; edges: GraphEdge[] };
type PendingDispatch = ToBlock & { id: string; sourceTaskId?: string };

let graphSaveTimer: ReturnType<typeof setTimeout> | undefined;
let listenersRegistered = false;
const seenDispatchKeys = new Set<string>();

const fallbackMao = {
  agent: {
    list: async (): Promise<Agent[]> => [],
    save: async (agent: Agent): Promise<Agent> => agent,
    delete: async (): Promise<void> => undefined
  },
  graph: {
    load: async (): Promise<GraphSnapshot> => ({ nodes: [], edges: [] }),
    save: async (): Promise<void> => undefined
  },
  task: {
    create: async (task: Task): Promise<Task> => task,
    list: async (): Promise<Task[]> => []
  },
  pty: {
    spawn: async (): Promise<{ ok: true } | { ok: false; error: string }> => ({ ok: true }),
    write: async (): Promise<void> => undefined,
    kill: async (): Promise<void> => undefined
  },
  log: {
    append: async (_agentId: string, _data: string): Promise<void> => undefined
  },
  onPtyData: (): (() => void) => () => undefined,
  onPtyStatus: (): (() => void) => () => undefined
};

const mao = () => window.mao ?? fallbackMao;

const createId = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const createNodeForAgent = (agentId: string, index: number, isRoot: boolean): GraphNode => ({
  id: createId("node"),
  agentId,
  position: {
    x: 80 + (index % 3) * 240,
    y: 80 + Math.floor(index / 3) * 150
  },
  isRoot
});

const saveGraphDebounced = (graph: GraphSnapshot): void => {
  if (graphSaveTimer) {
    clearTimeout(graphSaveTimer);
  }

  graphSaveTimer = setTimeout(() => {
    void mao().graph.save(graph).catch((error) => {
      console.error("Failed to save graph", error);
    });
  }, 500);
};

type AppState = {
  agents: Agent[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  tasks: Task[];
  selectedNodeId: string | null;
  rootNodeId: string | null;
  logs: Record<string, string[]>;
  pendingDispatches: PendingDispatch[];
  dispatchMode: TaskMode;
  loadAll: () => Promise<void>;
  addAgent: (agent: Agent) => Promise<void>;
  updateAgent: (agent: Agent) => Promise<void>;
  deleteAgent: (agentId: string) => Promise<void>;
  addNode: (agentId: string) => Promise<void>;
  updateNodePosition: (nodeId: string, position: GraphNode["position"]) => void;
  removeNode: (nodeId: string) => Promise<void>;
  connectNodes: (source: string, target: string) => Promise<void>;
  setRoot: (nodeId: string) => Promise<void>;
  selectNode: (nodeId: string | null) => void;
  appendLog: (agentId: string, data: string) => void;
  startAgent: (agentId: string) => Promise<void>;
  stopAgent: (agentId: string) => Promise<void>;
  runTask: (input: { title: string; body: string; mode: TaskMode }) => Promise<void>;
  dispatchToAgent: (agentId: string, body: string, pendingId?: string) => Promise<void>;
};

export const useAppStore = create<AppState>((set, get) => ({
  agents: [],
  nodes: [],
  edges: [],
  tasks: [],
  selectedNodeId: null,
  rootNodeId: null,
  logs: {},
  pendingDispatches: [],
  dispatchMode: "manual",

  loadAll: async () => {
    if (!listenersRegistered) {
      listenersRegistered = true;
      mao().onPtyData((event) => get().appendLog(event.agentId, event.data));
      mao().onPtyStatus((event) => {
        set((state) => ({
          agents: state.agents.map((agent) =>
            agent.id === event.agentId ? { ...agent, status: event.status } : agent
          )
        }));
      });
    }

    const [agents, graph, tasks] = await Promise.all([
      mao().agent.list(),
      mao().graph.load(),
      mao().task.list()
    ]);

    const existingAgentIds = new Set(graph.nodes.map((node) => node.agentId));
    const missingNodes = agents
      .filter((agent) => !existingAgentIds.has(agent.id))
      .map((agent, index) => createNodeForAgent(agent.id, graph.nodes.length + index, graph.nodes.length === 0 && index === 0));

    const nodes = [...graph.nodes, ...missingNodes];
    const rootNode = nodes.find((node) => node.isRoot) ?? nodes[0] ?? null;

    set({
      agents,
      nodes: rootNode ? nodes.map((node) => ({ ...node, isRoot: node.id === rootNode.id })) : nodes,
      edges: graph.edges,
      tasks,
      selectedNodeId: rootNode?.id ?? null,
      rootNodeId: rootNode?.id ?? null
    });

    if (missingNodes.length > 0 || (rootNode && !graph.nodes.some((node) => node.isRoot))) {
      saveGraphDebounced({ nodes: get().nodes, edges: get().edges });
    }
  },

  addAgent: async (agent) => {
    const savedAgent = await mao().agent.save(agent);
    set((state) => {
      const agents = [...state.agents.filter((item) => item.id !== savedAgent.id), savedAgent];
      const hasNode = state.nodes.some((node) => node.agentId === savedAgent.id);
      const node = hasNode
        ? undefined
        : createNodeForAgent(savedAgent.id, state.nodes.length, state.nodes.length === 0);
      const nodes = node ? [...state.nodes, node] : state.nodes;
      return {
        agents,
        nodes,
        rootNodeId: state.rootNodeId ?? node?.id ?? null,
        selectedNodeId: state.selectedNodeId ?? node?.id ?? null
      };
    });
    saveGraphDebounced({ nodes: get().nodes, edges: get().edges });
  },

  updateAgent: async (agent) => {
    const savedAgent = await mao().agent.save(agent);
    set((state) => ({
      agents: state.agents.map((item) => (item.id === savedAgent.id ? savedAgent : item))
    }));
  },

  deleteAgent: async (agentId) => {
    await mao().agent.delete(agentId);
    set((state) => {
      const removedNodeIds = new Set(
        state.nodes.filter((node) => node.agentId === agentId).map((node) => node.id)
      );
      const nodes = state.nodes.filter((node) => node.agentId !== agentId);
      const edges = state.edges.filter(
        (edge) => !removedNodeIds.has(edge.source) && !removedNodeIds.has(edge.target)
      );
      const rootNode = nodes.find((node) => node.isRoot) ?? nodes[0] ?? null;
      return {
        agents: state.agents.filter((agent) => agent.id !== agentId),
        nodes: rootNode ? nodes.map((node) => ({ ...node, isRoot: node.id === rootNode.id })) : nodes,
        edges,
        rootNodeId: rootNode?.id ?? null,
        selectedNodeId: state.selectedNodeId && removedNodeIds.has(state.selectedNodeId) ? rootNode?.id ?? null : state.selectedNodeId,
        logs: Object.fromEntries(Object.entries(state.logs).filter(([id]) => id !== agentId))
      };
    });
    saveGraphDebounced({ nodes: get().nodes, edges: get().edges });
  },

  addNode: async (agentId) => {
    set((state) => {
      const node = createNodeForAgent(agentId, state.nodes.length, state.nodes.length === 0);
      return {
        nodes: [...state.nodes, node],
        rootNodeId: state.rootNodeId ?? node.id,
        selectedNodeId: node.id
      };
    });
    saveGraphDebounced({ nodes: get().nodes, edges: get().edges });
  },

  updateNodePosition: (nodeId, position) => {
    set((state) => ({
      nodes: state.nodes.map((node) => (node.id === nodeId ? { ...node, position } : node))
    }));
    saveGraphDebounced({ nodes: get().nodes, edges: get().edges });
  },

  removeNode: async (nodeId) => {
    set((state) => {
      const nodes = state.nodes.filter((node) => node.id !== nodeId);
      const edges = state.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId);
      const rootNode = nodes.find((node) => node.isRoot) ?? nodes[0] ?? null;
      return {
        nodes: rootNode ? nodes.map((node) => ({ ...node, isRoot: node.id === rootNode.id })) : nodes,
        edges,
        rootNodeId: rootNode?.id ?? null,
        selectedNodeId: state.selectedNodeId === nodeId ? rootNode?.id ?? null : state.selectedNodeId
      };
    });
    saveGraphDebounced({ nodes: get().nodes, edges: get().edges });
  },

  connectNodes: async (source, target) => {
    if (source === target) {
      return;
    }

    set((state) => {
      const exists = state.edges.some((edge) => edge.source === source && edge.target === target);
      if (exists) {
        return state;
      }
      return {
        edges: [...state.edges, { id: `edge_${source}_${target}_${Date.now()}`, source, target }]
      };
    });
    saveGraphDebounced({ nodes: get().nodes, edges: get().edges });
  },

  setRoot: async (nodeId) => {
    set((state) => ({
      nodes: state.nodes.map((node) => ({ ...node, isRoot: node.id === nodeId })),
      rootNodeId: nodeId,
      selectedNodeId: nodeId
    }));
    saveGraphDebounced({ nodes: get().nodes, edges: get().edges });
  },

  selectNode: (nodeId) => set({ selectedNodeId: nodeId }),

  appendLog: (agentId, data) => {
    mao().log.append(agentId, data).catch(() => undefined);

    set((state) => ({
      logs: {
        ...state.logs,
        [agentId]: [...(state.logs[agentId] ?? []), data]
      }
    }));

    const state = get();
    const blocks = parseToBlocks((state.logs[agentId] ?? []).join(""), state.agents);
    const newBlocks = blocks.filter((block) => {
      if (!block.agentId) {
        return false;
      }
      const key = `${agentId}:${block.agentId}:${block.body}`;
      if (seenDispatchKeys.has(key)) {
        return false;
      }
      seenDispatchKeys.add(key);
      return true;
    });

    if (newBlocks.length === 0) {
      return;
    }

    if (state.dispatchMode === "auto") {
      void Promise.all(
        newBlocks
          .filter((block): block is ToBlock & { agentId: string } => Boolean(block.agentId))
          .map((block) => get().dispatchToAgent(block.agentId, block.body))
      );
      return;
    }

    if (newBlocks.length > 0) {
      set((current) => ({
        pendingDispatches: [
          ...current.pendingDispatches,
          ...newBlocks.map((block) => ({ ...block, id: createId("dispatch") }))
        ]
      }));
    }
  },

  startAgent: async (agentId) => {
    set((state) => ({
      agents: state.agents.map((agent) =>
        agent.id === agentId ? { ...agent, status: "starting" } : agent
      )
    }));

    const result = await mao().pty.spawn(agentId);
    if (!result.ok) {
      set((state) => ({
        agents: state.agents.map((agent) =>
          agent.id === agentId ? { ...agent, status: "error" } : agent
        )
      }));
      throw new Error(result.error);
    }
  },

  stopAgent: async (agentId) => {
    await mao().pty.kill(agentId);
    set((state) => ({
      agents: state.agents.map((agent) =>
        agent.id === agentId ? { ...agent, status: "stopped" } : agent
      )
    }));
  },

  runTask: async ({ title, body, mode }) => {
    seenDispatchKeys.clear();
    set({ dispatchMode: mode });
    const state = get();
    const rootNode = state.nodes.find((node) => node.id === state.rootNodeId);
    const rootAgent = state.agents.find((agent) => agent.id === rootNode?.agentId);
    if (!rootAgent) {
      throw new Error("Root agent is not selected.");
    }

    if (rootAgent.status !== "running") {
      set((current) => ({
        agents: current.agents.map((agent) =>
          agent.id === rootAgent.id ? { ...agent, status: "starting" } : agent
        )
      }));
      const result = await mao().pty.spawn(rootAgent.id);
      if (!result.ok) {
        set((current) => ({
          agents: current.agents.map((agent) =>
            agent.id === rootAgent.id ? { ...agent, status: "error" } : agent
          )
        }));
        throw new Error(result.error);
      }
    }

    const now = new Date().toISOString();
    const task: Task = {
      id: createId("task"),
      title,
      body,
      rootAgentId: rootAgent.id,
      status: "running",
      createdAt: now,
      updatedAt: now
    };
    const savedTask = await mao().task.create(task);
    set((current) => ({ tasks: [savedTask, ...current.tasks] }));

    const payload = `${rootAgent.systemPrompt ? `${rootAgent.systemPrompt}\n\n` : ""}${body}\r`;
    await mao().pty.write(rootAgent.id, payload);

    const blocks = parseToBlocks((get().logs[rootAgent.id] ?? []).join(""), get().agents);
    if (mode === "auto") {
      await Promise.all(
        blocks
          .filter((block): block is ToBlock & { agentId: string } => Boolean(block.agentId))
          .map((block) => get().dispatchToAgent(block.agentId, block.body))
      );
    }
  },

  dispatchToAgent: async (agentId, body, pendingId) => {
    const agent = get().agents.find((item) => item.id === agentId);
    if (!agent) {
      throw new Error("Agent not found.");
    }

    if (agent.status !== "running") {
      set((state) => ({
        agents: state.agents.map((item) =>
          item.id === agentId ? { ...item, status: "starting" } : item
        )
      }));
      const result = await mao().pty.spawn(agentId);
      if (!result.ok) {
        set((state) => ({
          agents: state.agents.map((item) =>
            item.id === agentId ? { ...item, status: "error" } : item
          )
        }));
        throw new Error(result.error);
      }
    }

    await mao().pty.write(agentId, `${agent.systemPrompt ? `${agent.systemPrompt}\n\n` : ""}${body}\r`);
    if (pendingId) {
      set((state) => ({
        pendingDispatches: state.pendingDispatches.filter((pending) => pending.id !== pendingId)
      }));
    }
  }
}));
