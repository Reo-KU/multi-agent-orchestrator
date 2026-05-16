import { useMemo, useState, type FormEvent, type ReactElement } from "react";
import { useAppStore } from "../store/useAppStore";
import type { Agent } from "../types";

type AgentFormProps = {
  agent?: Agent;
  onClose: () => void;
};

const createId = (): string =>
  `agent_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const emptyAgent = (): Agent => ({
  id: createId(),
  name: "",
  type: "custom",
  mode: "exec",
  command: "",
  args: [],
  workingDirectory: "",
  role: "",
  systemPrompt: "",
  status: "stopped"
});

export default function AgentForm({ agent, onClose }: AgentFormProps): ReactElement {
  const addAgent = useAppStore((state) => state.addAgent);
  const updateAgent = useAppStore((state) => state.updateAgent);
  const initial = useMemo(() => agent ?? emptyAgent(), [agent]);
  const [draft, setDraft] = useState<Agent>(initial);
  const [argsText, setArgsText] = useState((initial.args ?? []).join("\n"));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const update = <K extends keyof Agent>(key: K, value: Agent[K]): void => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError(null);

    if (!draft.name.trim() || !draft.command.trim()) {
      setError("Name and command are required.");
      return;
    }

    const payload: Agent = {
      ...draft,
      name: draft.name.trim(),
      mode: draft.mode ?? "exec",
      command: draft.command.trim(),
      args: argsText
        .split(/\n|,/)
        .map((item) => item.trim())
        .filter(Boolean),
      workingDirectory: draft.workingDirectory.trim(),
      role: draft.role.trim(),
      systemPrompt: draft.systemPrompt.trim()
    };

    setSaving(true);
    try {
      if (agent) {
        await updateAgent(payload);
      } else {
        await addAgent(payload);
      }
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to save agent.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-4">
      <form
        onSubmit={(event) => void onSubmit(event)}
        className="w-full max-w-2xl rounded border border-slate-700 bg-slate-900 shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <h2 className="text-sm font-semibold">{agent ? "Edit Agent" : "Add Agent"}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-sm text-slate-300 hover:bg-slate-800"
          >
            Close
          </button>
        </div>

        <div className="grid max-h-[72vh] gap-4 overflow-y-auto p-5">
          <label className="grid gap-1 text-sm">
            <span className="text-slate-300">Name</span>
            <input
              value={draft.name}
              onChange={(event) => update("name", event.target.value)}
              className="rounded border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-cyan-500"
              placeholder="Codex"
            />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-300">Type</span>
            <select
              value={draft.type}
              onChange={(event) => update("type", event.target.value as Agent["type"])}
              className="rounded border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-cyan-500"
            >
              <option value="claude">claude</option>
              <option value="codex">codex</option>
              <option value="grok">grok</option>
              <option value="gemini">gemini</option>
              <option value="custom">custom</option>
            </select>
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-300">Mode</span>
            <select
              value={draft.mode ?? "exec"}
              onChange={(event) => update("mode", event.target.value as Agent["mode"])}
              className="rounded border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-cyan-500"
            >
              <option value="exec">exec</option>
              <option value="interactive">interactive</option>
            </select>
          </label>

          <div className="grid grid-cols-2 gap-4">
            <label className="grid gap-1 text-sm">
              <span className="text-slate-300">Command</span>
              <input
                value={draft.command}
                onChange={(event) => update("command", event.target.value)}
                className="rounded border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-cyan-500"
                placeholder="codex"
              />
            </label>

            <label className="grid gap-1 text-sm">
              <span className="text-slate-300">Args</span>
              <input
                value={argsText}
                onChange={(event) => setArgsText(event.target.value)}
                className="rounded border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-cyan-500"
                placeholder="--model gpt-5"
              />
            </label>
          </div>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-300">Working Directory</span>
            <input
              value={draft.workingDirectory}
              onChange={(event) => update("workingDirectory", event.target.value)}
              className="rounded border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-cyan-500"
              placeholder="/Users/name/Desktop/project"
            />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-300">Role</span>
            <input
              value={draft.role}
              onChange={(event) => update("role", event.target.value)}
              className="rounded border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-cyan-500"
              placeholder="Frontend implementation"
            />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-300">System Prompt</span>
            <textarea
              value={draft.systemPrompt}
              onChange={(event) => update("systemPrompt", event.target.value)}
              className="min-h-28 rounded border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-cyan-500"
              placeholder="You are responsible for..."
            />
          </label>

          {error ? <p className="text-sm text-red-300">{error}</p> : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-800 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-700 px-3 py-2 text-sm hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded bg-cyan-500 px-3 py-2 text-sm font-medium text-slate-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
