import { useState, type ReactElement } from "react";
import { useAppStore } from "../store/useAppStore";
import AgentForm from "./AgentForm";

export default function Inspector(): ReactElement {
  const agents = useAppStore((state) => state.agents);
  const nodes = useAppStore((state) => state.nodes);
  const selectedNodeId = useAppStore((state) => state.selectedNodeId);
  const setRoot = useAppStore((state) => state.setRoot);
  const startAgent = useAppStore((state) => state.startAgent);
  const stopAgent = useAppStore((state) => state.stopAgent);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedNode = nodes.find((node) => node.id === selectedNodeId);
  const agent = agents.find((item) => item.id === selectedNode?.agentId);

  const start = async (): Promise<void> => {
    if (!agent) {
      return;
    }
    setError(null);
    try {
      await startAgent(agent.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to start agent.");
    }
  };

  const stop = async (): Promise<void> => {
    if (!agent) {
      return;
    }
    setError(null);
    try {
      await stopAgent(agent.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to stop agent.");
    }
  };

  return (
    <aside className="min-h-0 overflow-y-auto border-l border-slate-800 bg-slate-950">
      <div className="border-b border-slate-800 px-4 py-3">
        <h2 className="text-sm font-semibold">Inspector</h2>
      </div>

      {!agent || !selectedNode ? (
        <div className="p-4 text-sm text-slate-400">Select a node to inspect its agent.</div>
      ) : (
        <div className="grid gap-4 p-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">Agent</div>
            <div className="mt-1 text-base font-semibold">{agent.name}</div>
            <div className="text-sm text-slate-400">{agent.type}</div>
          </div>

          <Info label="Status" value={agent.status} />
          <Info label="Command" value={[agent.command, ...(agent.args ?? [])].join(" ")} />
          <Info label="Working Directory" value={agent.workingDirectory || "-"} />
          <Info label="Role" value={agent.role || "-"} />
          <Info label="System Prompt" value={agent.systemPrompt || "-"} multiline />

          {error ? <p className="rounded border border-red-900/70 bg-red-950/30 p-2 text-sm text-red-200">{error}</p> : null}

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => void start()}
              className="rounded bg-green-500 px-3 py-2 text-sm font-medium text-green-950 hover:bg-green-400"
            >
              Start
            </button>
            <button
              type="button"
              onClick={() => void stop()}
              className="rounded bg-red-500 px-3 py-2 text-sm font-medium text-red-950 hover:bg-red-400"
            >
              Stop
            </button>
            <button
              type="button"
              onClick={() => void setRoot(selectedNode.id)}
              className="rounded border border-slate-700 px-3 py-2 text-sm hover:bg-slate-800"
            >
              Set as Root
            </button>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded border border-slate-700 px-3 py-2 text-sm hover:bg-slate-800"
            >
              Edit
            </button>
          </div>
        </div>
      )}

      {editing && agent ? <AgentForm agent={agent} onClose={() => setEditing(false)} /> : null}
    </aside>
  );
}

function Info({
  label,
  value,
  multiline = false
}: {
  label: string;
  value: string;
  multiline?: boolean;
}): ReactElement {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-sm text-slate-200 ${multiline ? "whitespace-pre-wrap" : "truncate"}`}>
        {value}
      </div>
    </div>
  );
}
