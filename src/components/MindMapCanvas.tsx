import { memo, useEffect, useMemo, useState, type ReactElement } from "react";
import ReactFlow, {
  Handle,
  MarkerType,
  Position,
  useReactFlow,
  useStore,
  type Connection,
  type Edge,
  type Node,
  type NodeProps
} from "reactflow";
import "reactflow/dist/style.css";
import { getTranslations } from "../i18n";
import { useAppStore } from "../store/useAppStore";
import type { Agent, AgentLocale } from "../types";

const USER_NODE_ID = "__mao_user__";
const USER_EDGE_ID = "__user_to_root__";
const userPosition = { x: -200, y: -100 };

export default function MindMapCanvas(): ReactElement {
  const agents = useAppStore((state) => state.agents);
  const graphNodes = useAppStore((state) => state.nodes);
  const graphEdges = useAppStore((state) => state.edges);
  const selectedNodeId = useAppStore((state) => state.selectedNodeId);
  const selectNode = useAppStore((state) => state.selectNode);
  const setSelectedAgentId = useAppStore((state) => state.setSelectedAgentId);
  const updateNodePosition = useAppStore((state) => state.updateNodePosition);
  const connectNodes = useAppStore((state) => state.connectNodes);
  const removeEdge = useAppStore((state) => state.removeEdge);
  const setRoot = useAppStore((state) => state.setRoot);
  const locale = useAppStore((state) => state.locale);

  const agentById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents]);

  const nodes: Node<AgentNodeData | UserNodeData>[] = useMemo(
    () => {
      const userNode: Node<UserNodeData> = {
        id: USER_NODE_ID,
        type: "user",
        position: userPosition,
        data: { locale },
        draggable: true,
        deletable: false,
        selectable: false
      };
      const agentNodes: Node<AgentNodeData>[] = graphNodes.map((node) => {
        const agent = agentById.get(node.agentId);
        return {
          id: node.id,
          type: "agent",
          position: node.position,
          selected: selectedNodeId === node.id,
          data: {
            agent,
            isRoot: node.isRoot,
            locale
          }
        };
      });
      return [userNode, ...agentNodes];
    },
    [agentById, graphNodes, locale, selectedNodeId]
  );

  const edges: Edge[] = useMemo(() => {
    const rootNode = graphNodes.find((node) => node.isRoot);
    const virtualEdges: Edge[] = rootNode
      ? [
          {
            id: USER_EDGE_ID,
            source: USER_NODE_ID,
            target: rootNode.id,
            type: "smoothstep",
            markerEnd: { type: MarkerType.ArrowClosed },
            deletable: false,
            style: { stroke: "url(#userRootGrad)", strokeWidth: 1.5, strokeDasharray: "4 4" }
          }
        ]
      : [];
    const realEdges = graphEdges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: "smoothstep",
        markerEnd: { type: MarkerType.ArrowClosed }
      }));
    return [...virtualEdges, ...realEdges];
  }, [graphEdges, graphNodes]);

  const onConnect = (connection: Connection): void => {
    if (connection.source === USER_NODE_ID && connection.target) {
      void setRoot(connection.target);
      return;
    }
    if (connection.target === USER_NODE_ID) return;
    if (connection.source && connection.target) {
      void connectNodes(connection.source, connection.target);
    }
  };

  const handleEdgesDelete = (deleted: Edge[]): void => {
    for (const edge of deleted) {
      if (edge.id === USER_EDGE_ID) continue;
      void removeEdge(edge.id);
    }
  };

  return (
    <section className="fixed inset-0 bg-transparent">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        panOnDrag
        proOptions={{ hideAttribution: true }}
        deleteKeyCode={["Backspace", "Delete"]}
        onNodeClick={(_, node) => {
          if (node.id !== USER_NODE_ID) {
            selectNode(node.id);
            const graphNode = graphNodes.find((item) => item.id === node.id);
            setSelectedAgentId(graphNode?.agentId ?? null);
          }
        }}
        onPaneClick={() => {
          selectNode(null);
          setSelectedAgentId(null);
        }}
        onNodeDragStop={(_, node) => {
          if (node.id !== USER_NODE_ID) updateNodePosition(node.id, node.position);
        }}
        onConnect={onConnect}
        onEdgesDelete={handleEdgesDelete}
      >
        <EdgeToolbar />
        <svg width="0" height="0">
          <defs>
            <linearGradient id="userRootGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#5856d6" />
              <stop offset="100%" stopColor="#ff7a3d" />
            </linearGradient>
          </defs>
        </svg>
      </ReactFlow>
    </section>
  );
}

function EdgeToolbar(): ReactElement | null {
  const reactFlow = useReactFlow();
  const removeEdge = useAppStore((state) => state.removeEdge);
  const selectedEdges = useStore((state) =>
    state.edges.filter((edge) => edge.selected && edge.id !== USER_EDGE_ID)
  );
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const selectedEdge = selectedEdges.length === 1 ? selectedEdges[0] : null;

  useEffect(() => {
    if (!selectedEdge) {
      setPos(null);
      return;
    }

    const sourceNode = reactFlow.getNode(selectedEdge.source);
    const targetNode = reactFlow.getNode(selectedEdge.target);
    if (!sourceNode || !targetNode) {
      setPos(null);
      return;
    }

    const sourceX = sourceNode.position.x + (sourceNode.width ?? 200) / 2;
    const sourceY = sourceNode.position.y + (sourceNode.height ?? 60) / 2;
    const targetX = targetNode.position.x + (targetNode.width ?? 200) / 2;
    const targetY = targetNode.position.y + (targetNode.height ?? 60) / 2;
    const mid = reactFlow.flowToScreenPosition({
      x: (sourceX + targetX) / 2,
      y: (sourceY + targetY) / 2
    });
    setPos(mid);
  }, [reactFlow, selectedEdge]);

  if (!pos || !selectedEdge) {
    return null;
  }

  const onDelete = (): void => {
    void removeEdge(selectedEdge.id);
    reactFlow.setEdges((edges) => edges.filter((edge) => edge.id !== selectedEdge.id));
  };

  return (
    <div
      style={{ top: pos.y, left: pos.x }}
      className="pointer-events-auto fixed z-40 -translate-x-1/2 -translate-y-1/2 rounded-full border border-brand-line bg-brand-surface/95 px-3 py-1.5 text-xs shadow-2xl backdrop-blur"
    >
      <button
        type="button"
        onClick={onDelete}
        className="font-medium text-brand-ember hover:underline"
      >
        Disconnect
      </button>
    </div>
  );
}

type AgentNodeData = {
  agent?: Agent;
  isRoot: boolean;
  locale: AgentLocale;
};

type UserNodeData = {
  locale: AgentLocale;
};

const nodeTypes = {
  agent: memo(function AgentNode({ data, selected }: NodeProps<AgentNodeData>): ReactElement {
    const status = data.agent?.status ?? "idle";
    const t = getTranslations(data.locale);
    const statusClass = {
      idle: "border-brand-violet/30 shadow-[0_0_18px_rgba(88,86,214,0.30)]",
      stopped: "opacity-50",
      starting: "mao-ring-starting animate-pulse border-brand-sunsetA/60 shadow-[0_0_20px_rgba(255,122,61,0.35)]",
      running: "mao-ring-running border-brand-aurora/60 shadow-[0_0_22px_rgba(52,199,89,0.45)]",
      error: "animate-pulse border-brand-ember/70 shadow-[0_0_22px_rgba(255,59,48,0.45)]"
    }[status];
    const role = data.agent?.role || data.agent?.mode || data.agent?.type || "";

    return (
      <div
        className={`relative min-w-[180px] cursor-pointer rounded-2xl border border-brand-line bg-brand-surface/80 px-4 py-3 text-brand-text shadow-2xl backdrop-blur transition-all ${statusClass} ${
          selected ? "ring-2 ring-brand-sunsetA/60 ring-offset-2 ring-offset-brand-bg" : ""
        }`}
      >
        <Handle type="target" position={Position.Top} className="!h-2 !w-8 !rounded-full !border-0 !bg-brand-violet/50" />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-brand-text">{data.agent?.name ?? t.mindMap.missingAgent}</div>
          <div className="mt-1 truncate text-[10px] uppercase tracking-[0.18em] text-brand-textDim">
            {role || (data.isRoot ? t.mindMap.root : data.agent?.status ?? "")}
          </div>
        </div>
        <Handle type="source" position={Position.Bottom} className="!h-2 !w-8 !rounded-full !border-0 !bg-brand-violet/50" />
      </div>
    );
  }),
  user: memo(function UserNode(_: NodeProps<UserNodeData>): ReactElement {
    return (
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-brand-violet/40 to-brand-sunsetA/40 text-2xl shadow-[0_0_24px_rgba(255,122,61,0.35)]">
        👤
        <Handle type="source" position={Position.Bottom} className="!h-2 !w-8 !rounded-full !border-0 !bg-brand-sunsetA/60" />
      </div>
    );
  })
};
