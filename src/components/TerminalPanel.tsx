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
  const [ttydUrl, setTtydUrl] = useState<string | null>(null);

  const activeAgent = useMemo(
    () => agents.find((agent) => agent.id === activeAgentId) ?? agents[0],
    [activeAgentId, agents]
  );
  const activeIsInteractive = (activeAgent?.mode ?? "exec") === "interactive";

  useEffect(() => {
    if (!activeAgentId && agents[0]) {
      setActiveAgentId(agents[0].id);
    }
  }, [activeAgentId, agents]);

  useEffect(() => {
    if (!activeIsInteractive) {
      setTtydUrl(null);
      return;
    }

    let active = true;
    void window.mao.tty.getUrl().then((url) => {
      if (active) {
        setTtydUrl(url);
      }
    });

    return () => {
      active = false;
    };
  }, [activeIsInteractive, activeAgent?.id]);

  useEffect(() => {
    if (!containerRef.current || !activeAgent || activeIsInteractive) {
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

    const inputDisposable = terminal.onData((data) => {
      void window.mao.pty.write(activeAgent.id, data);
    });

    const onResize = (): void => fitAddon.fit();
    window.addEventListener("resize", onResize);

    return () => {
      inputDisposable.dispose();
      window.removeEventListener("resize", onResize);
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [activeAgent?.id, activeIsInteractive]);

  useEffect(() => {
    if (!activeAgent || !terminalRef.current || activeIsInteractive) {
      return;
    }

    const entries = logs[activeAgent.id] ?? [];
    const writtenCount = writtenCountsRef.current[activeAgent.id] ?? 0;
    const nextEntries = entries.slice(writtenCount);
    nextEntries.forEach((entry) => terminalRef.current?.write(maskSecrets(entry)));
    writtenCountsRef.current[activeAgent.id] = entries.length;
    terminalRef.current.scrollToBottom();
  }, [activeAgent, activeIsInteractive, logs]);

  const handleTabClick = (agentId: string): void => {
    setActiveAgentId(agentId);
    const target = agents.find((agent) => agent.id === agentId);
    if ((target?.mode ?? "exec") === "interactive") {
      void window.mao.tmux.selectWindow(agentId);
    }
  };

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
              onClick={() => handleTabClick(agent.id)}
              className={`rounded px-3 py-1.5 text-xs ${
                activeAgent?.id === agent.id
                  ? "bg-cyan-500 text-slate-950"
                  : "border border-slate-800 text-slate-300 hover:bg-slate-900"
              }`}
            >
              {agent.name}
              {agent.status === "running" ? (
                <span className="ml-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-green-400 align-middle" />
              ) : null}
            </button>
          ))}
          {activeAgent ? (
            <div className="ml-auto flex items-center gap-1">
              <button
                type="button"
                onClick={() => void window.mao.pty.write(activeAgent.id, "\x03")}
                title="Send Ctrl+C (SIGINT) to this agent"
                className="rounded border border-slate-800 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-900"
              >
                ^C
              </button>
              <button
                type="button"
                onClick={() => void window.mao.pty.kill(activeAgent.id)}
                disabled={activeAgent.status !== "running" && activeAgent.status !== "starting"}
                title="Kill this agent's running process (SIGHUP)"
                className="rounded bg-red-500 px-2.5 py-1 text-[11px] font-medium text-red-950 hover:bg-red-400 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
              >
                ■ Stop
              </button>
            </div>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-hidden p-2">
          {activeAgent ? (
            activeIsInteractive && ttydUrl ? (
              <iframe
                src={`${ttydUrl}?arg=&fontSize=12`}
                className="h-full w-full rounded border border-slate-800 bg-slate-950"
                title={`${activeAgent.name} terminal`}
                allow="clipboard-read; clipboard-write"
              />
            ) : (
              <div ref={containerRef} className="h-full rounded border border-slate-800 bg-slate-950 p-2" />
            )
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
