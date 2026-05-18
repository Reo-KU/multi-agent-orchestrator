import { useState, type FormEvent, type ReactElement } from "react";
import { getTranslations } from "../i18n";
import { useAppStore } from "../store/useAppStore";

export default function TaskInput(): ReactElement {
  const rootNodeId = useAppStore((state) => state.rootNodeId);
  const nodes = useAppStore((state) => state.nodes);
  const agents = useAppStore((state) => state.agents);
  const pendingDispatches = useAppStore((state) => state.pendingDispatches);
  const runningTaskId = useAppStore((state) => state.runningTaskId);
  const runTask = useAppStore((state) => state.runTask);
  const dispatchToAgent = useAppStore((state) => state.dispatchToAgent);
  const cancelCurrentTask = useAppStore((state) => state.cancelCurrentTask);
  const locale = useAppStore((state) => state.locale);
  const t = getTranslations(locale);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [mode, setMode] = useState<"manual" | "auto">("manual");
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const rootNode = nodes.find((node) => node.id === rootNodeId);
  const rootAgent = agents.find((agent) => agent.id === rootNode?.agentId);

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError(null);

    if (!title.trim() || !body.trim()) {
      setError(t.taskInput.validation);
      return;
    }

    setRunning(true);
    try {
      await runTask({ title: title.trim(), body: body.trim(), mode });
      setTitle("");
      setBody("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.taskInput.runError);
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="border-t border-slate-800 bg-slate-950">
      <form onSubmit={(event) => void onSubmit(event)} className="grid gap-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">{t.taskInput.label}</h2>
            <p className="text-xs text-slate-400">
              {t.taskInput.root}: {rootAgent ? `${rootAgent.name} (${rootAgent.status})` : t.taskInput.notSelected}
            </p>
          </div>
          <div className="flex rounded border border-slate-700 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setMode("manual")}
              className={`rounded px-3 py-1.5 ${mode === "manual" ? "bg-cyan-500 text-slate-950" : "text-slate-300 hover:bg-slate-800"}`}
            >
              {t.taskInput.modeManual}
            </button>
            <button
              type="button"
              onClick={() => setMode("auto")}
              className={`rounded px-3 py-1.5 ${mode === "auto" ? "bg-cyan-500 text-slate-950" : "text-slate-300 hover:bg-slate-800"}`}
            >
              {t.taskInput.modeAuto}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-[260px_minmax(0,1fr)_128px] gap-3">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-cyan-500"
            placeholder={t.taskInput.title}
          />
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            className="h-20 resize-none rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-cyan-500"
            placeholder={t.taskInput.detail}
          />
          <div className="grid h-20 gap-2">
            <button
              type="submit"
              disabled={running || Boolean(runningTaskId) || !rootAgent}
              className="rounded bg-cyan-500 px-3 py-2 text-sm font-medium text-slate-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {running || runningTaskId ? t.taskInput.running : t.taskInput.run}
            </button>
            {runningTaskId ? (
              <button
                type="button"
                onClick={() => void cancelCurrentTask()}
                className="rounded bg-red-500 px-3 py-1.5 text-sm font-medium text-red-950 hover:bg-red-400"
                title={t.taskInput.stopTaskTooltip}
              >
                {t.taskInput.stopTask}
              </button>
            ) : null}
          </div>
        </div>

        {error ? <p className="text-sm text-red-300">{error}</p> : null}
      </form>

      {pendingDispatches.length > 0 ? (
        <div className="grid gap-2 border-t border-slate-800 px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {t.taskInput.candidatesLabel}
          </div>
          <div className="grid max-h-36 gap-2 overflow-y-auto">
            {pendingDispatches.map((pending) => {
              const agent = agents.find((item) => item.id === pending.agentId);
              return (
                <div
                  key={pending.id}
                  className="grid grid-cols-[160px_minmax(0,1fr)_96px] items-start gap-3 rounded border border-slate-800 bg-slate-900/60 p-3"
                >
                  <div className="text-sm">
                    <div className="font-medium">{pending.agentName}</div>
                    <div className="text-xs text-slate-400">{agent?.name ?? t.taskInput.unmatched}</div>
                  </div>
                  <pre className="max-h-24 overflow-auto whitespace-pre-wrap text-xs text-slate-300">
                    {pending.body}
                  </pre>
                  <button
                    type="button"
                    disabled={!pending.agentId}
                    onClick={() => {
                      if (pending.agentId) {
                        void dispatchToAgent(pending.agentId, pending.body, pending.id);
                      }
                    }}
                    className="rounded bg-green-500 px-3 py-2 text-sm font-medium text-green-950 hover:bg-green-400 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {t.taskInput.send}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}
