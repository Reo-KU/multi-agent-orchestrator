import { useEffect, useRef, useState, type FormEvent, type ReactElement } from "react";
import { getTranslations } from "../i18n";
import { useAppStore } from "../store/useAppStore";

const deriveTitle = (body: string): string => {
  const firstLine = body.split("\n").find((line) => line.trim().length > 0)?.trim();
  return firstLine ? firstLine.slice(0, 80) : "Task";
};

export default function TaskInput(): ReactElement {
  const rootNodeId = useAppStore((state) => state.rootNodeId);
  const nodes = useAppStore((state) => state.nodes);
  const agents = useAppStore((state) => state.agents);
  const dispatchMode = useAppStore((state) => state.dispatchMode);
  const runningTaskId = useAppStore((state) => state.runningTaskId);
  const runTask = useAppStore((state) => state.runTask);
  const cancelCurrentTask = useAppStore((state) => state.cancelCurrentTask);
  const terminalDrawerOpen = useAppStore((state) => state.terminalDrawerOpen);
  const locale = useAppStore((state) => state.locale);
  const t = getTranslations(locale);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const rootNode = nodes.find((node) => node.id === rootNodeId);
  const rootAgent = agents.find((agent) => agent.id === rootNode?.agentId);
  const isRunning = Boolean(runningTaskId);
  const disabled = !rootAgent;

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const submitValue = async (): Promise<void> => {
    if (isRunning || disabled || !value.trim()) {
      return;
    }

    const body = value.trim();
    setValue("");
    await runTask({ title: deriveTitle(body), body, mode: dispatchMode });
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    await submitValue();
  };

  const onAction = (): void => {
    if (isRunning) {
      void cancelCurrentTask();
      return;
    }

    void submitValue();
  };

  return (
    <form
      onSubmit={(event) => void onSubmit(event)}
      style={{ bottom: terminalDrawerOpen ? "calc(40vh + 1.75rem)" : "1.75rem" }}
      className="fixed left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 transition-[bottom] duration-300"
    >
      <div className="flex h-12 w-[640px] items-center rounded-full border border-brand-line bg-brand-surface/90 px-6 shadow-2xl backdrop-blur-lg transition focus-within:border-brand-sunsetA/60 focus-within:shadow-[0_0_32px_rgba(255,122,61,0.15)]">
        <svg
          viewBox="0 0 24 24"
          className="mr-3 h-4 w-4 shrink-0 fill-current text-brand-textDim"
          aria-hidden="true"
        >
          <path d="M10 4a6 6 0 1 1-4.2 10.27l-3.5 3.5a1 1 0 1 1-1.4-1.42l3.48-3.49A6 6 0 0 1 10 4Zm0 2a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" />
        </svg>
        <input
          ref={inputRef}
          id="mao-spotlight"
          type="text"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={disabled ? t.taskInput.placeholderNoRoot : t.taskInput.placeholder}
          disabled={isRunning || disabled}
          className="flex-1 bg-transparent text-sm text-brand-text placeholder-brand-textDim/70 focus:outline-none disabled:opacity-50"
          autoComplete="off"
          spellCheck={false}
        />
        <kbd className="ml-2 hidden shrink-0 font-mono text-[10px] tracking-wide text-brand-textDim/70 sm:inline-flex">
          ⌘⏎
        </kbd>
      </div>

      <button
        type="button"
        onClick={onAction}
        disabled={!isRunning && (disabled || !value.trim())}
        className={`relative flex h-16 w-16 items-center justify-center rounded-full shadow-2xl transition ${
          isRunning
            ? "bg-brand-ember hover:bg-brand-ember/90"
            : disabled || !value.trim()
              ? "cursor-not-allowed bg-brand-surfaceHi text-brand-textDim"
              : "bg-gradient-to-br from-brand-sunsetA to-brand-sunsetB text-white shadow-[0_0_32px_rgba(255,61,138,0.4)] hover:scale-105 active:scale-100"
        }`}
        aria-label={isRunning ? t.taskInput.stopTask : t.taskInput.run}
        title={isRunning ? t.taskInput.stopTaskTooltip : t.taskInput.runTooltip}
      >
        {isRunning ? (
          <span className="block h-5 w-5 rounded-sm bg-brand-text" />
        ) : (
          <svg viewBox="0 0 24 24" className="ml-0.5 h-6 w-6 fill-current" aria-hidden="true">
            <path d="M8 5v14l11-7L8 5Z" />
          </svg>
        )}
        {isRunning ? (
          <span className="absolute inset-0 animate-ping rounded-full border-2 border-brand-ember/60" />
        ) : null}
      </button>
    </form>
  );
}
