import { useEffect, useState, type ReactElement } from "react";
import { useAppStore } from "../store/useAppStore";
import type { Agent, AgentSummary } from "../types";
import AgentForm from "./AgentForm";

const permissionHints: Record<Agent["type"], string[]> = {
  codex: [
    "--sandbox workspace-write  (cwd 内書き込み許可)",
    "--dangerously-bypass-approvals-and-sandbox  (全承認スキップ・危険)"
  ],
  claude: [
    "--permission-mode acceptEdits  (編集を自動承認)",
    "--dangerously-skip-permissions  (全承認スキップ・危険)"
  ],
  gemini: [
    "--approval-mode auto_edit  (編集を自動承認)",
    "--yolo  (全承認スキップ・危険)"
  ],
  grok: ["(grok の権限フラグは CLI のドキュメントを参照)"],
  custom: ["(該当 CLI のドキュメントを参照)"]
};

const policyBadgeClasses: Record<NonNullable<Agent["permissionPolicy"]>, string> = {
  ask: "border-yellow-700 bg-yellow-950/40 text-yellow-200",
  "safe-auto": "border-green-700 bg-green-950/40 text-green-200",
  yolo: "border-red-700 bg-red-950/40 text-red-200"
};

const safeAutoFlags: Record<Agent["type"], string> = {
  codex: "--sandbox workspace-write",
  claude: "--permission-mode acceptEdits",
  gemini: "--approval-mode auto_edit",
  grok: "(なし)",
  custom: "(なし)"
};

const yoloFlags: Record<Agent["type"], string> = {
  codex: "--dangerously-bypass-approvals-and-sandbox",
  claude: "--dangerously-skip-permissions",
  gemini: "--yolo",
  grok: "(なし)",
  custom: "(なし)"
};

export default function Inspector(): ReactElement {
  const agents = useAppStore((state) => state.agents);
  const nodes = useAppStore((state) => state.nodes);
  const selectedNodeId = useAppStore((state) => state.selectedNodeId);
  const setRoot = useAppStore((state) => state.setRoot);
  const startAgent = useAppStore((state) => state.startAgent);
  const stopAgent = useAppStore((state) => state.stopAgent);
  const updateAgent = useAppStore((state) => state.updateAgent);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<AgentSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const selectedNode = nodes.find((node) => node.id === selectedNodeId);
  const agent = agents.find((item) => item.id === selectedNode?.agentId);
  const agentMode = agent?.mode ?? "exec";
  const policy = agent?.permissionPolicy ?? "safe-auto";
  const policyFlags =
    policy === "ask" ? "(フラグ無し)" : policy === "safe-auto" && agent ? safeAutoFlags[agent.type] : agent ? yoloFlags[agent.type] : "(なし)";

  const loadSummary = async (agentId: string): Promise<void> => {
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      setSummary(await window.mao.agent.loadSummary(agentId));
    } catch (caught) {
      setSummaryError(caught instanceof Error ? caught.message : "Failed to load agent history.");
      setSummary(null);
    } finally {
      setSummaryLoading(false);
    }
  };

  useEffect(() => {
    if (!agent) {
      setSummary(null);
      return;
    }

    void loadSummary(agent.id);
  }, [agent?.id]);

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
    <aside className="flex h-full min-h-0 flex-col bg-slate-950">
      <div className="border-b border-slate-800 px-4 py-3">
        <h2 className="text-sm font-semibold">Inspector</h2>
      </div>

      {!agent || !selectedNode ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-4 text-sm text-slate-400">
          Select a node to inspect its agent.
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">Agent</div>
            <div className="mt-1 text-base font-semibold">{agent.name}</div>
            <div className="text-sm text-slate-400">{agent.type}</div>
          </div>

          <Info label="Status" value={agent.status} />
          <label className="grid gap-1 text-sm">
            <span className="text-xs uppercase tracking-wide text-slate-500">Mode</span>
            <select
              value={agentMode}
              onChange={(event) => {
                void updateAgent({ ...agent, mode: event.target.value as "exec" | "interactive" });
              }}
              className="rounded border border-slate-700 bg-slate-900 px-3 py-2 outline-none focus:border-cyan-500"
            >
              <option value="exec">Exec (recommended)</option>
              <option value="interactive">Interactive (legacy)</option>
            </select>
          </label>
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">Permission Policy</div>
            <div className="mt-1 flex items-center gap-2">
              <span className={`rounded border px-2 py-0.5 text-[11px] font-medium ${policyBadgeClasses[policy]}`}>
                {policy}
              </span>
              <span className="text-xs text-slate-400">{policyFlags}</span>
            </div>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="mt-1 text-[11px] text-cyan-400 hover:underline"
            >
              変更 (Edit)
            </button>
          </div>
          <Info label="Command" value={[agent.command, ...(agent.args ?? [])].join(" ")} />
          <details className="rounded border border-slate-800 bg-slate-900/40 p-2">
            <summary className="cursor-pointer text-xs text-slate-400">
              権限ヒント (type={agent.type})
            </summary>
            <ul className="mt-2 space-y-1 text-xs text-slate-300">
              {permissionHints[agent.type].map((line) => (
                <li key={line}>- {line}</li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-slate-500">
              Args 欄に貼り付けて使用してください。承認 UI が必要なら最下部 Terminal を直接操作することも可能です。
            </p>
          </details>
          <Info label="Working Directory" value={agent.workingDirectory || "-"} />
          <Info label="Role" value={agent.role || "-"} />
          <Info label="System Prompt" value={agent.systemPrompt || "-"} multiline />

          {error ? <p className="rounded border border-red-900/70 bg-red-950/30 p-2 text-sm text-red-200">{error}</p> : null}

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => void start()}
              disabled={agentMode === "exec"}
              title={agentMode === "exec" ? "exec mode は task 実行時に自動 spawn します" : undefined}
              className="rounded bg-green-500 px-3 py-2 text-sm font-medium text-green-950 hover:bg-green-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Start
            </button>
            <button
              type="button"
              onClick={() => void stop()}
              disabled={agentMode === "exec" && agent.status !== "running" && agent.status !== "starting"}
              title={
                agentMode === "exec" && agent.status !== "running" && agent.status !== "starting"
                  ? "exec mode の Stop は実行中のみ有効"
                  : "実行中のプロセスを終了 (SIGHUP)"
              }
              className="rounded bg-red-500 px-3 py-2 text-sm font-medium text-red-950 hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-50"
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

          <div className="border-t border-slate-800 pt-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">直近の応答履歴</h3>
              <button
                type="button"
                onClick={() => void loadSummary(agent.id)}
                className="rounded border border-slate-700 px-2 py-1 text-xs hover:bg-slate-800"
              >
                Refresh
              </button>
            </div>
            <AgentHistoryView
              summary={summary}
              loading={summaryLoading}
              error={summaryError}
            />
          </div>
        </div>
      )}

      {editing && agent ? <AgentForm agent={agent} onClose={() => setEditing(false)} /> : null}
    </aside>
  );
}

function AgentHistoryView({
  summary,
  loading,
  error
}: {
  summary: AgentSummary | null;
  loading: boolean;
  error: string | null;
}): ReactElement {
  if (loading) {
    return <p className="text-sm text-slate-400">Loading...</p>;
  }

  if (error) {
    return <p className="rounded border border-red-900/70 bg-red-950/30 p-2 text-sm text-red-200">{error}</p>;
  }

  const entries = summary?.recentEntries.slice(0, 5) ?? [];
  if (entries.length === 0) {
    return <p className="text-sm text-slate-500">履歴なし</p>;
  }

  return (
    <div className="grid gap-2">
      {entries.map((entry) => (
        <div
          key={`${entry.taskId}-${entry.at}`}
          className="rounded border border-slate-800 bg-slate-900/60 p-3"
        >
          <div className="mb-2 flex items-center justify-between gap-2 text-xs text-slate-400">
            <span>{formatTime(entry.at)} · task:{entry.taskId.slice(-6)}</span>
            <span className="rounded bg-slate-800 px-2 py-0.5 text-slate-300">
              → {entry.emittedDispatches.length} dispatch
            </span>
          </div>
          <div className="truncate text-xs text-slate-300" title={entry.receivedBody}>
            {entry.receivedBody || "(empty input)"}
          </div>
          <pre className="mt-2 max-h-20 overflow-auto whitespace-pre-wrap text-xs text-slate-400">
            {entry.responseLastMessage || "(no response)"}
          </pre>
        </div>
      ))}
    </div>
  );
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
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
