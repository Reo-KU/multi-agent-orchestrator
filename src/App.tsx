import type { ReactElement } from "react";
import AgentList from "./components/AgentList";
import Inspector from "./components/Inspector";
import MindMapCanvas from "./components/MindMapCanvas";
import TaskInput from "./components/TaskInput";
import TerminalPanel from "./components/TerminalPanel";

export default function App(): ReactElement {
  return (
    <main className="flex h-screen flex-col bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 px-4 py-3">
        <h1 className="text-base font-semibold">Multi-Agent CLI Orchestrator</h1>
      </header>
      <section className="grid min-h-0 flex-1 grid-cols-[240px_minmax(0,1fr)_280px]">
        <AgentList />
        <MindMapCanvas />
        <Inspector />
      </section>
      <TaskInput />
      <TerminalPanel />
    </main>
  );
}
