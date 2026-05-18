import { memo, useMemo, type ReactElement } from "react";
import ReactFlow, {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
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
  const updateNodePosition = useAppStore((state) => state.updateNodePosition);
  const connectNodes = useAppStore((state) => state.connectNodes);
  const removeEdge = useAppStore((state) => state.removeEdge);
  const setRoot = useAppStore((state) => state.setRoot);
  const removeNode = useAppStore((state) => state.removeNode);
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
            onSetRoot: () => void setRoot(node.id),
            onDelete: () => void removeNode(node.id),
            locale
          }
        };
      });
      return [userNode, ...agentNodes];
    },
    [agentById, graphNodes, locale, removeNode, selectedNodeId, setRoot]
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
            style: { stroke: "#22d3ee", strokeWidth: 2.5, strokeDasharray: "4 2" }
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
    <section className="flex min-h-0 min-w-0 flex-1 bg-slate-900">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        deleteKeyCode={["Backspace", "Delete"]}
        onNodeClick={(_, node) => {
          if (node.id !== USER_NODE_ID) selectNode(node.id);
        }}
        onPaneClick={() => selectNode(null)}
        onNodeDragStop={(_, node) => {
          if (node.id !== USER_NODE_ID) updateNodePosition(node.id, node.position);
        }}
        onConnect={onConnect}
        onEdgesDelete={handleEdgesDelete}
      >
        <Background color="#334155" gap={24} />
        <Controls className="!border-slate-700 !bg-slate-900 !shadow-none [&_button]:!border-slate-700 [&_button]:!bg-slate-900 [&_button]:!fill-slate-100" />
      </ReactFlow>
    </section>
  );
}

type AgentNodeData = {
  agent?: Agent;
  isRoot: boolean;
  onSetRoot: () => void;
  onDelete: () => void;
  locale: AgentLocale;
};

type UserNodeData = {
  locale: AgentLocale;
};

const nodeTypes = {
  agent: memo(function AgentNode({ data }: NodeProps<AgentNodeData>): ReactElement {
    const status = data.agent?.status ?? "stopped";
    const t = getTranslations(data.locale);
    const dotColor = {
      stopped: "bg-slate-500",
      starting: "bg-yellow-400",
      running: "bg-green-400",
      error: "bg-red-500"
    }[status];
    const statusClass = {
      stopped: "border-slate-700",
      starting: "border-yellow-400 mao-node-starting",
      running: "border-cyan-400 mao-node-running",
      error: "border-red-500 mao-node-error"
    }[status];

    return (
      <div className={`min-w-48 rounded border bg-slate-950 px-3 py-2 text-slate-100 shadow-lg ${statusClass}`}>
        <Handle type="target" position={Position.Top} className="!bg-cyan-400" />
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${dotColor}`} />
              <span className="truncate text-sm font-medium">{data.agent?.name ?? t.mindMap.missingAgent}</span>
            </div>
            <div className="mt-1 truncate text-xs text-slate-400">{data.agent?.role || data.agent?.command}</div>
          </div>
          {data.isRoot ? (
            <span className="rounded bg-cyan-500 px-1.5 py-0.5 text-[10px] font-semibold text-slate-950">
              {t.mindMap.root}
            </span>
          ) : null}
        </div>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              data.onSetRoot();
            }}
            className="rounded border border-slate-700 px-2 py-1 text-[11px] hover:bg-slate-800"
          >
            {t.mindMap.setAsRoot}
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              data.onDelete();
            }}
            className="rounded border border-red-900/70 px-2 py-1 text-[11px] text-red-300 hover:bg-red-950/40"
          >
            {t.mindMap.deleteNode}
          </button>
        </div>
        <Handle type="source" position={Position.Bottom} className="!bg-cyan-400" />
      </div>
    );
  }),
  user: memo(function UserNode({ data }: NodeProps<UserNodeData>): ReactElement {
    const t = getTranslations(data.locale);
    return (
      <div
        className="flex w-32 flex-col items-center gap-1 rounded-full border-2 border-cyan-500 bg-cyan-950/70 px-4 py-3 text-cyan-100 shadow-lg"
        title={t.mindMap.userHint}
      >
        <span className="text-2xl">👤</span>
        <span className="text-xs font-medium">{t.mindMap.user}</span>
        <Handle type="source" position={Position.Bottom} className="!bg-cyan-400" />
      </div>
    );
  })
};
