import { create } from "zustand";
import type {
  Agent,
  AgentHistoryEntry,
  AgentMode,
  AgentRunRequest,
  AgentRunResult,
  AgentSummary,
  ContextSnapshot,
  GraphEdge,
  GraphNode,
  Task,
  TaskState
} from "../types";
import { parseToBlocks, type ToBlock } from "../utils/parseToBlocks";

type TaskMode = "manual" | "auto";
type GraphSnapshot = { nodes: GraphNode[]; edges: GraphEdge[] };
type PendingDispatch = ToBlock & { id: string; taskId?: string };

let graphSaveTimer: ReturnType<typeof setTimeout> | undefined;
let listenersRegistered = false;
const seenDispatchKeys = new Set<string>();

const fallbackMao = {
  agent: {
    list: async (): Promise<Agent[]> => [],
    save: async (agent: Agent): Promise<Agent> => agent,
    delete: async (): Promise<void> => undefined,
    run: async (_request: AgentRunRequest): Promise<AgentRunResult> => ({
      ok: false,
      error: "window.mao.agent.run is not available."
    }),
    loadSummary: async (_agentId: string): Promise<AgentSummary | null> => null,
    appendHistory: async (_agentId: string, _entry: AgentHistoryEntry): Promise<void> => undefined
  },
  project: {
    loadSummary: async (): Promise<string> => "",
    saveSummary: async (_text: string): Promise<void> => undefined
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

const submitToAgent = async (agentId: string, payload: string): Promise<void> => {
  await mao().pty.write(agentId, payload);
  // Submit as a separate keystroke. TUI clients like Codex can treat batched
  // "\r" as paste-newline instead of form submission.
  await new Promise((resolve) => setTimeout(resolve, 600));
  await mao().pty.write(agentId, "\r");
};

const getDispatchKey = (block: ToBlock): string => `${block.agentId ?? "_"}::${block.body}`;

type TreeNode = { agent: Agent; children: TreeNode[] };

function buildDescendantTree(
  rootAgentId: string,
  agents: Agent[],
  nodes: GraphNode[],
  edges: GraphEdge[]
): TreeNode | null {
  const startNode = nodes.find((node) => node.agentId === rootAgentId);
  if (!startNode) {
    return null;
  }

  const visited = new Set<string>();
  const visit = (nodeId: string): TreeNode | null => {
    if (visited.has(nodeId)) {
      return null;
    }
    visited.add(nodeId);

    const node = nodes.find((item) => item.id === nodeId);
    if (!node) {
      return null;
    }

    const agent = agents.find((item) => item.id === node.agentId);
    if (!agent) {
      return null;
    }

    const childNodes = edges
      .filter((edge) => edge.source === nodeId)
      .map((edge) => visit(edge.target))
      .filter((child): child is TreeNode => Boolean(child));

    return { agent, children: childNodes };
  };

  return visit(startNode.id);
}

function renderTree(node: TreeNode, prefix = "", isLast = true): string[] {
  const connector = prefix === "" ? "" : isLast ? "└── " : "├── ";
  const line = `${prefix}${connector}${node.agent.name}${node.agent.role ? ` (${node.agent.role})` : ""}`;
  const childPrefix = prefix + (prefix === "" ? "" : isLast ? "    " : "│   ");
  const childLines = node.children.flatMap((child, index) =>
    renderTree(child, childPrefix, index === node.children.length - 1)
  );

  return [line, ...childLines];
}

function collectAllDescendants(node: TreeNode): Agent[] {
  const out: Agent[] = [];
  for (const child of node.children) {
    out.push(child.agent);
    out.push(...collectAllDescendants(child));
  }
  return out;
}

function buildAgentIntro(
  agent: Agent,
  agents: Agent[],
  nodes: GraphNode[],
  edges: GraphEdge[]
): string {
  const tree = buildDescendantTree(agent.id, agents, nodes, edges);
  if (!tree) {
    return "";
  }

  const directChildren = tree.children.map((child) => child.agent);
  const allDescendants = collectAllDescendants(tree);

  const lines: string[] = [];
  lines.push(`あなたは MAO (Multi-Agent Orchestrator) に接続されたエージェント「${agent.name}」です。`);
  if (agent.role) {
    lines.push(`役割: ${agent.role}`);
  }
  lines.push("");

  lines.push("【MAO の仕組み - 必ず読む】");
  lines.push("あなたの応答テキストは MAO がリアルタイムに stdout を監視しています。");
  lines.push("あなたが次の形式の行を出力すると:");
  lines.push("");
  lines.push("    [TO: <エージェント名>]");
  lines.push("    <そのエージェントへの指示>");
  lines.push("");
  lines.push("MAO はそのテキストを自動的に対象エージェントへ転送します。");
  lines.push("これが MAO における唯一の「他エージェントへの指示」方法です。");
  lines.push("特別なツール・API・関数呼び出し・Codex Apps・Spawn 機能は一切不要です。");
  lines.push("ただ標準出力に [TO: ...] 形式のテキストを出力するだけで、MAO が物理的に配送します。");
  lines.push("「配送手段がない」「ツールが提供されていない」と判断するのは誤りです。");
  lines.push("");

  if (directChildren.length > 0) {
    lines.push("【あなたが指示できるエージェント】");
    lines.push("直接の子 (あなたから [TO:] で直接送れる):");
    for (const child of directChildren) {
      lines.push(`  - ${child.name}${child.role ? ` (${child.role})` : ""}`);
    }

    if (allDescendants.length > directChildren.length) {
      lines.push("");
      lines.push("孫以降のエージェント (子に再分配を依頼する形で届く):");
      for (const descendant of allDescendants) {
        if (!directChildren.includes(descendant)) {
          lines.push(`  - ${descendant.name}${descendant.role ? ` (${descendant.role})` : ""}`);
        }
      }
    }

    lines.push("");
    lines.push("全体ツリー:");
    for (const treeLine of renderTree(tree)) {
      lines.push(`  ${treeLine}`);
    }
    lines.push("");
    lines.push("孫エージェント (例: codex4) に届けたい場合は、間の子エージェント (例: codex2) に");
    lines.push("「codex4 に〜と伝えてください」と [TO: codex2] で依頼してください。");
    lines.push("間の子エージェントは更に [TO: codex4] で再分配します。");
  } else {
    lines.push("【あなたは末端エージェント】");
    lines.push("子エージェントはいません。受け取った指示にそのまま簡潔に応答してください。");
  }

  lines.push("");
  lines.push("【出力ルール】");
  lines.push("- 短い分析や思考は OK。ただし最終出力に必ず [TO: ...] ブロックを含めること (末端エージェントを除く)");
  lines.push("- [TO: ...] ブロックの後に本文を改行で続ける。複数ブロック並べてよい");
  lines.push("- 不可能を検出したら、その旨を1行で書いたあとで可能な範囲の [TO:] を出すこと");
  lines.push("  (例: 「codex4 は孫なので codex2 経由で依頼する」→ そのまま [TO: codex2] を出す)");
  lines.push("");
  lines.push("【厳守 - 絶対】");
  lines.push('- codex 内部の "Spawned ..." / Codex Apps / MCP サブエージェント機能は使用禁止');
  lines.push("- 「ツールがない」「配送できない」とは言わない。[TO:] テキスト出力自体が配送行為");
  lines.push("- 何もせず沈黙しない。必ず何らかの応答を出す");
  lines.push("");
  lines.push("これは MAO セッション初期化メッセージです。次に来るユーザーメッセージが実タスクです。");
  lines.push("実タスクを受け取ったら、上記ルールに従って [TO: ...] ブロックで応答してください。");

  return lines.join("\n");
}

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
  introducedAgents: Set<string>;
  loadAll: () => Promise<void>;
  addAgent: (agent: Agent) => Promise<void>;
  updateAgent: (agent: Agent) => Promise<void>;
  deleteAgent: (agentId: string) => Promise<void>;
  addNode: (agentId: string) => Promise<void>;
  updateNodePosition: (nodeId: string, position: GraphNode["position"]) => void;
  removeNode: (nodeId: string) => Promise<void>;
  connectNodes: (source: string, target: string) => Promise<void>;
  removeEdge: (edgeId: string) => Promise<void>;
  setRoot: (nodeId: string) => Promise<void>;
  selectNode: (nodeId: string | null) => void;
  appendLog: (agentId: string, data: string) => void;
  ensureAgentReady: (agentId: string) => Promise<void>;
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
  introducedAgents: new Set<string>(),

  loadAll: async () => {
    if (!listenersRegistered) {
      listenersRegistered = true;
      mao().onPtyData((event) => get().appendLog(event.agentId, event.data));
      mao().onPtyStatus((event) => {
        set((state) => {
          const agents = state.agents.map((agent) =>
            agent.id === event.agentId ? { ...agent, status: event.status } : agent
          );
          let introducedAgents = state.introducedAgents;

          if (
            (event.status === "stopped" || event.status === "error") &&
            introducedAgents.has(event.agentId)
          ) {
            introducedAgents = new Set(introducedAgents);
            introducedAgents.delete(event.agentId);
          }

          return { agents, introducedAgents };
        });
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

  removeEdge: async (edgeId) => {
    set((state) => ({
      edges: state.edges.filter((edge) => edge.id !== edgeId)
    }));
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
    const sourceAgent = state.agents.find((agent) => agent.id === agentId);
    if ((sourceAgent?.mode ?? "exec") === "exec") {
      return;
    }

    const blocks = parseToBlocks((state.logs[agentId] ?? []).join(""), state.agents);
    const newBlocks = blocks.filter((block) => {
      if (!block.agentId) {
        return false;
      }
      const key = getDispatchKey(block);
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
      const latestByAgent = new Map<string, ToBlock & { agentId: string }>();
      for (const block of newBlocks) {
        if (block.agentId) {
          latestByAgent.set(block.agentId, { ...block, agentId: block.agentId });
        }
      }
      const latestBlocks = [...latestByAgent.values()];

      set((current) => ({
        pendingDispatches: [
          ...current.pendingDispatches.filter(
            (pending) => !latestByAgent.has(pending.agentId ?? "")
          ),
          ...latestBlocks.map((block) => ({
            ...block,
            id: createId("dispatch"),
            taskId: current.tasks[0]?.id
          }))
        ]
      }));
    }
  },

  ensureAgentReady: async (agentId) => {
    const state = get();
    const agent = state.agents.find((item) => item.id === agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }
    const mode: AgentMode = agent.mode ?? "exec";
    if (mode === "exec") {
      return;
    }

    const wasRunning = agent.status === "running";
    if (!wasRunning) {
      set((current) => ({
        agents: current.agents.map((item) =>
          item.id === agentId ? { ...item, status: "starting" } : item
        )
      }));

      const result = await mao().pty.spawn(agentId);
      if (!result.ok) {
        set((current) => ({
          agents: current.agents.map((item) =>
            item.id === agentId ? { ...item, status: "error" } : item
          )
        }));
        throw new Error(result.error);
      }

      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    const latest = get();
    if (latest.introducedAgents.has(agentId)) {
      return;
    }

    const latestAgent = latest.agents.find((item) => item.id === agentId) ?? agent;
    const intro = buildAgentIntro(latestAgent, latest.agents, latest.nodes, latest.edges);
    const systemPromptPart = latestAgent.systemPrompt ? `\n\n${latestAgent.systemPrompt}` : "";
    const payload = intro + systemPromptPart;

    if (payload.trim().length > 0) {
      await submitToAgent(agentId, payload);
      await new Promise((resolve) => setTimeout(resolve, 4000));
    }

    set((current) => ({
      introducedAgents: new Set([...current.introducedAgents, agentId])
    }));
  },

  startAgent: async (agentId) => {
    const agent = get().agents.find((item) => item.id === agentId);
    if ((agent?.mode ?? "exec") === "exec") {
      return;
    }
    await get().ensureAgentReady(agentId);
  },

  stopAgent: async (agentId) => {
    const agent = get().agents.find((item) => item.id === agentId);
    if ((agent?.mode ?? "exec") === "exec") {
      return;
    }
    await mao().pty.kill(agentId);
    set((state) => ({
      agents: state.agents.map((agent) =>
        agent.id === agentId ? { ...agent, status: "stopped" } : agent
      ),
      introducedAgents: new Set([...state.introducedAgents].filter((id) => id !== agentId)),
      logs: { ...state.logs, [agentId]: [] }
    }));
  },

  runTask: async ({ title, body, mode: dispatchMode }) => {
    const state = get();
    const rootNode = state.nodes.find((node) => node.id === state.rootNodeId);
    const rootAgent = state.agents.find((agent) => agent.id === rootNode?.agentId);
    if (!rootAgent) {
      throw new Error("Root agent is not selected.");
    }

    const existingBlocks = parseToBlocks((state.logs[rootAgent.id] ?? []).join(""), state.agents);
    seenDispatchKeys.clear();
    for (const block of existingBlocks) {
      seenDispatchKeys.add(getDispatchKey(block));
    }
    set({ pendingDispatches: [], dispatchMode });

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

    const taskState: TaskState = {
      taskId: savedTask.id,
      title,
      originalBody: body,
      rootAgentId: rootAgent.id,
      dispatchHistory: [],
      status: "running",
      createdAt: now
    };

    await executeForAgent(rootAgent.id, body, taskState, dispatchMode, set, get);
  },

  dispatchToAgent: async (agentId, body, pendingId) => {
    const state = get();
    const pending = pendingId
      ? state.pendingDispatches.find((item) => item.id === pendingId)
      : undefined;
    const taskId = pending?.taskId ?? state.tasks[0]?.id;
    if (pendingId) {
      set((state) => ({
        pendingDispatches: state.pendingDispatches.filter((pending) => pending.id !== pendingId)
      }));
    }

    if (!taskId) {
      const now = new Date().toISOString();
      const orphanTaskState: TaskState = {
        taskId: createId("task"),
        title: "(orphan dispatch)",
        originalBody: body,
        rootAgentId: agentId,
        dispatchHistory: [],
        status: "running",
        createdAt: now
      };
      await executeForAgent(agentId, body, orphanTaskState, "manual", set, get);
      return;
    }

    const taskRow = state.tasks.find((task) => task.id === taskId);
    const taskState: TaskState = {
      taskId,
      title: taskRow?.title ?? "",
      originalBody: taskRow?.body ?? "",
      rootAgentId: taskRow?.rootAgentId ?? agentId,
      dispatchHistory: [],
      status: "running",
      createdAt: taskRow?.createdAt ?? new Date().toISOString()
    };

    await executeForAgent(agentId, body, taskState, state.dispatchMode, set, get);
  }
}));

async function buildContextSnapshot(
  agentId: string,
  taskState: TaskState
): Promise<ContextSnapshot> {
  const state = useAppStore.getState();
  const [projectSummary, agentSummary] = await Promise.all([
    mao().project.loadSummary(),
    mao().agent.loadSummary(agentId)
  ]);

  return {
    taskState,
    projectSummary: projectSummary ?? "",
    agentSummary: agentSummary ?? null,
    graph: {
      nodes: state.nodes.map((node) => {
        const agent = state.agents.find((item) => item.id === node.agentId);
        return {
          agentId: node.agentId,
          name: agent?.name ?? "",
          role: agent?.role ?? "",
          isRoot: node.isRoot
        };
      }),
      edges: state.edges.map((edge) => {
        const source = state.nodes.find((node) => node.id === edge.source)?.agentId;
        const target = state.nodes.find((node) => node.id === edge.target)?.agentId;
        return { source: source ?? "", target: target ?? "" };
      })
    }
  };
}

async function executeForAgent(
  agentId: string,
  body: string,
  taskState: TaskState,
  dispatchMode: TaskMode,
  setState: typeof useAppStore.setState,
  getState: typeof useAppStore.getState
): Promise<void> {
  const state = getState();
  const agent = state.agents.find((item) => item.id === agentId);
  if (!agent) {
    return;
  }

  const effectiveMode: AgentMode = agent.mode ?? "exec";
  if (effectiveMode === "interactive") {
    await state.ensureAgentReady(agentId);
    await submitToAgent(agentId, body);
    return;
  }

  const context = await buildContextSnapshot(agentId, taskState);
  const result = await mao().agent.run({
    agentId,
    body,
    taskId: taskState.taskId,
    context
  });

  if (!result.ok) {
    getState().appendLog(agentId, `\n[MAO ERROR] ${result.error}\n`);
    return;
  }

  const latestAgents = getState().agents;
  const blocks = parseToBlocks(result.lastMessage, latestAgents);
  const emitted = blocks
    .filter((block): block is ToBlock & { agentId: string } => Boolean(block.agentId))
    .map((block) => ({ to: block.agentId, body: block.body }));

  await mao().agent.appendHistory(agentId, {
    taskId: taskState.taskId,
    receivedBody: body,
    responseLastMessage: result.lastMessage,
    emittedDispatches: emitted,
    at: new Date().toISOString(),
    elapsedMs: result.elapsedMs
  });

  for (const item of emitted) {
    taskState.dispatchHistory.push({
      taskId: taskState.taskId,
      from: agentId,
      to: item.to,
      body: item.body,
      at: new Date().toISOString()
    });
  }

  const validBlocks = blocks.filter(
    (block): block is ToBlock & { agentId: string } => Boolean(block.agentId)
  );
  if (validBlocks.length === 0) {
    return;
  }

  if (dispatchMode === "auto") {
    await Promise.all(
      validBlocks.map((block) =>
        executeForAgent(block.agentId, block.body, taskState, dispatchMode, setState, getState)
      )
    );
    return;
  }

  setState((current) => {
    const additions = validBlocks.map((block) => ({
      ...block,
      id: createId("pending"),
      taskId: taskState.taskId
    }));
    return {
      pendingDispatches: [
        ...current.pendingDispatches.filter(
          (pending) => !additions.some((addition) => addition.agentId === pending.agentId)
        ),
        ...additions
      ]
    };
  });
}
