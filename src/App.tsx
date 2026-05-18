import { useEffect, useState, type ReactElement } from "react";
import AgentForm from "./components/AgentForm";
import GearMenu from "./components/GearMenu";
import InspectorPopover from "./components/InspectorPopover";
import MindMapCanvas from "./components/MindMapCanvas";
import PermissionDialog from "./components/PermissionDialog";
import ProjectSummaryModal from "./components/ProjectSummaryModal";
import SetupCheckModal from "./components/SetupCheckModal";
import TaskInput from "./components/TaskInput";
import TerminalDrawer from "./components/TerminalDrawer";
import { useAppStore } from "./store/useAppStore";
import type { SetupCheckResult } from "./types";

export default function App(): ReactElement {
  const loadAll = useAppStore((state) => state.loadAll);
  const selectedAgentId = useAppStore((state) => state.selectedAgentId);
  const locale = useAppStore((state) => state.locale);
  const setLocale = useAppStore((state) => state.setLocale);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [agentFormOpen, setAgentFormOpen] = useState(false);
  const [setupModalOpen, setSetupModalOpen] = useState(false);
  const [setupResult, setSetupResult] = useState<SetupCheckResult | null>(null);
  const [setupDismissed, setSetupDismissed] = useState(false);
  const [rechecking, setRechecking] = useState(false);

  useEffect(() => {
    void loadAll().catch((error) => {
      console.error("Failed to load app state", error);
    });
  }, [loadAll]);

  useEffect(() => {
    void window.mao.setup.check().then(setSetupResult).catch((error) => {
      console.error("Failed to run setup check", error);
    });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        document.getElementById("mao-spotlight")?.focus();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const recheckSetup = async (): Promise<void> => {
    setRechecking(true);
    try {
      setSetupResult(await window.mao.setup.check());
    } finally {
      setRechecking(false);
    }
  };

  const openSetup = (): void => {
    setSetupModalOpen(true);
    void recheckSetup();
  };

  const missingRequired =
    setupResult?.tools.some((tool) => tool.category === "required" && !tool.available) ?? false;
  const showSetupModal = Boolean(setupResult && (setupModalOpen || (!setupDismissed && missingRequired)));

  return (
    <div className="fixed inset-0 overflow-hidden bg-brand-bg text-brand-text">
      <MindMapCanvas />

      <GearMenu
        onOpenProjectSummary={() => setProjectModalOpen(true)}
        onOpenSetup={openSetup}
        locale={locale}
        onLocaleChange={setLocale}
      />

      <button
        type="button"
        onClick={() => setAgentFormOpen(true)}
        className="fixed bottom-6 left-6 z-30 flex h-14 w-14 items-center justify-center rounded-full border border-brand-line bg-brand-violet/20 text-2xl text-brand-text shadow-xl backdrop-blur transition hover:bg-brand-violet/40"
        aria-label="Add agent"
      >
        +
      </button>

      {selectedAgentId ? <InspectorPopover /> : null}
      <TaskInput />
      <TerminalDrawer />

      {projectModalOpen ? <ProjectSummaryModal onClose={() => setProjectModalOpen(false)} /> : null}
      {showSetupModal && setupResult ? (
        <SetupCheckModal
          result={setupResult}
          onDismiss={() => {
            setSetupDismissed(true);
            setSetupModalOpen(false);
          }}
          onRecheck={() => void recheckSetup()}
          rechecking={rechecking}
        />
      ) : null}
      {agentFormOpen ? <AgentForm onClose={() => setAgentFormOpen(false)} /> : null}
      <PermissionDialog />
    </div>
  );
}
