import { useEffect, useState, type ReactElement, type MouseEvent } from "react";
import AgentList from "./components/AgentList";
import Inspector from "./components/Inspector";
import MindMapCanvas from "./components/MindMapCanvas";
import ProjectSummaryModal from "./components/ProjectSummaryModal";
import TaskInput from "./components/TaskInput";
import TerminalPanel from "./components/TerminalPanel";
import { useAppStore } from "./store/useAppStore";

export default function App(): ReactElement {
  const loadAll = useAppStore((state) => state.loadAll);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [leftWidth, setLeftWidth] = useState<number>(() => {
    const stored = Number.parseInt(localStorage.getItem("mao.leftWidth") ?? "", 10);
    return Number.isFinite(stored) && stored > 0 ? stored : 280;
  });
  const [rightWidth, setRightWidth] = useState<number>(() => {
    const stored = Number.parseInt(localStorage.getItem("mao.rightWidth") ?? "", 10);
    return Number.isFinite(stored) && stored > 0 ? stored : 320;
  });

  useEffect(() => {
    void loadAll().catch((error) => {
      console.error("Failed to load app state", error);
    });
  }, [loadAll]);

  useEffect(() => {
    localStorage.setItem("mao.leftWidth", String(leftWidth));
  }, [leftWidth]);

  useEffect(() => {
    localStorage.setItem("mao.rightWidth", String(rightWidth));
  }, [rightWidth]);

  const startResize = (side: "left" | "right") => (event: MouseEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = side === "left" ? leftWidth : rightWidth;

    const onMove = (moveEvent: globalThis.MouseEvent): void => {
      const delta = moveEvent.clientX - startX;
      if (side === "left") {
        setLeftWidth(Math.min(600, Math.max(180, startWidth + delta)));
      } else {
        setRightWidth(Math.min(600, Math.max(220, startWidth - delta)));
      }
    };

    const onUp = (): void => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  return (
    <main className="flex h-screen flex-col bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 px-4 py-3">
        <h1 className="text-base font-semibold">Multi-Agent CLI Orchestrator</h1>
      </header>
      <section className="flex min-h-0 flex-1">
        <aside
          style={{ width: leftWidth }}
          className="flex h-full min-h-0 shrink-0 flex-col border-r border-slate-800 bg-slate-950"
        >
          <div className="border-b border-slate-800 p-3">
            <button
              type="button"
              onClick={() => setProjectModalOpen(true)}
              className="w-full rounded border border-slate-700 px-3 py-2 text-left text-sm font-medium hover:bg-slate-900"
            >
              📋 Project Summary
            </button>
          </div>
          <AgentList />
        </aside>
        <div
          role="separator"
          aria-orientation="vertical"
          onMouseDown={startResize("left")}
          onDoubleClick={() => setLeftWidth(280)}
          className="w-1 shrink-0 cursor-col-resize bg-slate-800 transition-colors hover:bg-cyan-500"
          title="ドラッグして左パネルの幅を変更"
        />
        <main className="flex min-w-0 flex-1 flex-col">
          <MindMapCanvas />
        </main>
        <div
          role="separator"
          aria-orientation="vertical"
          onMouseDown={startResize("right")}
          onDoubleClick={() => setRightWidth(320)}
          className="w-1 shrink-0 cursor-col-resize bg-slate-800 transition-colors hover:bg-cyan-500"
          title="ドラッグして右パネルの幅を変更"
        />
        <aside
          style={{ width: rightWidth }}
          className="flex h-full min-h-0 shrink-0 flex-col border-l border-slate-800 bg-slate-950"
        >
          <Inspector />
        </aside>
      </section>
      <TaskInput />
      <TerminalPanel />
      {projectModalOpen ? (
        <ProjectSummaryModal onClose={() => setProjectModalOpen(false)} />
      ) : null}
    </main>
  );
}
