import { useState, type ReactElement } from "react";
import { useAppStore } from "../store/useAppStore";
import type { Agent } from "../types";
import AgentForm from "./AgentForm";

export default function AgentList(): ReactElement {
  const agents = useAppStore((state) => state.agents);
  const nodes = useAppStore((state) => state.nodes);
  const addNode = useAppStore((state) => state.addNode);
  const deleteAgent = useAppStore((state) => state.deleteAgent);
  const selectNode = useAppStore((state) => state.selectNode);
  const [formAgent, setFormAgent] = useState<Agent | null | undefined>(undefined);

  const selectAgent = (agentId: string): void => {
    const node = nodes.find((item) => item.agentId === agentId);
    if (node) {
      selectNode(node.id);
    }
  };

  return (
    <aside className="min-h-0 border-r border-slate-800 bg-slate-950">
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <h2 className="text-sm font-semibold">Agents</h2>
        <button
          type="button"
          onClick={() => setFormAgent(null)}
          className="rounded bg-cyan-500 px-2.5 py-1.5 text-xs font-medium text-slate-950 hover:bg-cyan-400"
        >
          + Add Agent
        </button>
      </div>

      <div className="flex h-full min-h-0 flex-col gap-2 overflow-y-auto p-3">
        {agents.length === 0 ? (
          <p className="rounded border border-dashed border-slate-700 p-3 text-sm text-slate-400">
            No agents registered.
          </p>
        ) : null}

        {agents.map((agent) => {
          const hasNode = nodes.some((node) => node.agentId === agent.id);
          return (
            <div
              key={agent.id}
              className="rounded border border-slate-800 bg-slate-900/70 p-3"
              onClick={() => selectAgent(agent.id)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{agent.name}</div>
                  <div className="truncate text-xs text-slate-400">{agent.role || agent.command}</div>
                </div>
                <StatusBadge status={agent.status} />
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setFormAgent(agent);
                  }}
                  className="rounded border border-slate-700 px-2 py-1 text-xs hover:bg-slate-800"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    void deleteAgent(agent.id);
                  }}
                  className="rounded border border-red-900/70 px-2 py-1 text-xs text-red-300 hover:bg-red-950/40"
                >
                  Delete
                </button>
                {!hasNode ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      void addNode(agent.id);
                    }}
                    className="rounded border border-slate-700 px-2 py-1 text-xs hover:bg-slate-800"
                  >
                    Add Node
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {formAgent !== undefined ? (
        <AgentForm agent={formAgent ?? undefined} onClose={() => setFormAgent(undefined)} />
      ) : null}
    </aside>
  );
}

function StatusBadge({ status }: { status: Agent["status"] }): ReactElement {
  const color = {
    stopped: "bg-slate-700 text-slate-200",
    starting: "bg-yellow-400 text-yellow-950",
    running: "bg-green-500 text-green-950",
    error: "bg-red-500 text-red-950"
  }[status];

  return <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${color}`}>{status}</span>;
}
