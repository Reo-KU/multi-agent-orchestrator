import { useEffect, useState, type ReactElement } from "react";
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

  useEffect(() => {
    void loadAll().catch((error) => {
      console.error("Failed to load app state", error);
    });
  }, [loadAll]);

  return (
    <main className="flex h-screen flex-col bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 px-4 py-3">
        <h1 className="text-base font-semibold">Multi-Agent CLI Orchestrator</h1>
      </header>
      <section className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)_320px]">
        <div className="min-h-0 border-r border-slate-800 bg-slate-950">
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
        </div>
        <MindMapCanvas />
        <Inspector />
      </section>
      <TaskInput />
      <TerminalPanel />
      {projectModalOpen ? (
        <ProjectSummaryModal onClose={() => setProjectModalOpen(false)} />
      ) : null}
    </main>
  );
}
