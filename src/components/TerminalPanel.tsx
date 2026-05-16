import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useAppStore } from "../store/useAppStore";
import { maskSecrets } from "../utils/maskSecrets";

export default function TerminalPanel(): ReactElement {
  const agents = useAppStore((state) => state.agents);
  const logs = useAppStore((state) => state.logs);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const writtenCountsRef = useRef<Record<string, number>>({});

  const activeAgent = useMemo(
    () => agents.find((agent) => agent.id === activeAgentId) ?? agents[0],
    [activeAgentId, agents]
  );

  useEffect(() => {
    if (!activeAgentId && agents[0]) {
      setActiveAgentId(agents[0].id);
    }
  }, [activeAgentId, agents]);

  useEffect(() => {
    if (!containerRef.current || !activeAgent) {
      return;
    }

    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: 12,
      theme: {
        background: "#020617",
        foreground: "#e2e8f0",
        cursor: "#22d3ee"
      }
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    requestAnimationFrame(() => fitAddon.fit());
    const entries = logs[activeAgent.id] ?? [];
    entries.forEach((entry) => terminal.write(maskSecrets(entry)));
    writtenCountsRef.current[activeAgent.id] = entries.length;

    const onResize = (): void => fitAddon.fit();
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [activeAgent?.id]);

  useEffect(() => {
    if (!activeAgent || !terminalRef.current) {
      return;
    }

    const entries = logs[activeAgent.id] ?? [];
    const writtenCount = writtenCountsRef.current[activeAgent.id] ?? 0;
    const nextEntries = entries.slice(writtenCount);
    nextEntries.forEach((entry) => terminalRef.current?.write(maskSecrets(entry)));
    writtenCountsRef.current[activeAgent.id] = entries.length;
    terminalRef.current.scrollToBottom();
  }, [activeAgent, logs]);

  return (
    <section className="h-56 border-t border-slate-800 bg-slate-950">
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center gap-1 overflow-x-auto border-b border-slate-800 px-3 py-2">
          {agents.length === 0 ? (
            <span className="text-xs text-slate-500">No terminal sessions</span>
          ) : null}
          {agents.map((agent) => (
            <button
              key={agent.id}
              type="button"
              onClick={() => setActiveAgentId(agent.id)}
              className={`rounded px-3 py-1.5 text-xs ${
                activeAgent?.id === agent.id
                  ? "bg-cyan-500 text-slate-950"
                  : "border border-slate-800 text-slate-300 hover:bg-slate-900"
              }`}
            >
              {agent.name}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-hidden p-2">
          {activeAgent ? (
            <div ref={containerRef} className="h-full rounded border border-slate-800 bg-slate-950 p-2" />
          ) : (
            <div className="flex h-full items-center justify-center rounded border border-slate-800 text-sm text-slate-500">
              Terminal output will appear here.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
