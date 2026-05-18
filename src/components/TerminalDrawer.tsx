import { useEffect, useState, type ReactElement } from "react";
import TerminalPanel from "./TerminalPanel";
import { useAppStore } from "../store/useAppStore";

export default function TerminalDrawer(): ReactElement {
  const open = useAppStore((state) => state.terminalDrawerOpen);
  const setOpenStore = useAppStore((state) => state.setTerminalDrawerOpen);
  const setOpen = (value: boolean | ((current: boolean) => boolean)): void => {
    if (typeof value === "function") {
      setOpenStore(value(useAppStore.getState().terminalDrawerOpen));
    } else {
      setOpenStore(value);
    }
  };
  const [userClosed, setUserClosed] = useState(false);
  const runningTaskId = useAppStore((state) => state.runningTaskId);

  // タスク実行が始まったら自動で展開 (ユーザーが明示的に閉じていない限り)
  useEffect(() => {
    if (runningTaskId && !userClosed) {
      setOpen(true);
    }
    if (!runningTaskId) {
      setUserClosed(false);
    }
  }, [runningTaskId, userClosed]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && (event.key === "j" || event.key === "J")) {
        event.preventDefault();
        setOpen((current) => {
          if (current) setUserClosed(true);
          return !current;
        });
      } else if (event.key === "Escape") {
        setOpen(false);
        setUserClosed(true);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggle = (): void => {
    setOpen((current) => {
      if (current) setUserClosed(true);
      return !current;
    });
  };

  return (
    <>
      {/* 開閉ボタン (右下) — drawer が閉じている時のみ表示 */}
      {!open ? (
        <button
          type="button"
          onClick={toggle}
          className="fixed bottom-6 right-6 z-30 flex h-11 w-11 items-center justify-center rounded-full border border-brand-line bg-brand-surface/95 text-brand-textDim shadow-2xl backdrop-blur-lg transition hover:bg-brand-surfaceHi hover:text-brand-text"
          aria-label="Show terminal"
          title="Show terminal (⌘J)"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
            <path d="M3 4h18a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm1 4v11h16V8H4Zm2.7 2.3 1.4 1.4-1.85 1.85 1.85 1.85-1.4 1.4-3.25-3.25 3.25-3.25ZM11 16h6v1.5h-6V16Z" />
          </svg>
        </button>
      ) : null}
      {/* 細い handle (中央下端) も残す */}
      <button
        type="button"
        onClick={toggle}
        className="fixed bottom-0 left-1/2 z-20 h-1.5 w-24 -translate-x-1/2 rounded-t-full bg-brand-line transition hover:bg-brand-textDim"
        aria-label="Toggle terminal"
      />
      <div
        className={`fixed inset-x-0 bottom-0 z-30 transition-transform duration-300 ${
          open ? "translate-y-0" : "translate-y-full"
        }`}
      >
        <div className="flex h-[40vh] flex-col border-t border-brand-line bg-brand-surface backdrop-blur-lg">
          {/* drawer ヘッダーバー — title + close */}
          <div className="flex shrink-0 items-center justify-between border-b border-brand-line px-4 py-2">
            <div className="flex items-center gap-2">
              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-brand-textDim">
                <path d="M3 4h18a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm1 4v11h16V8H4Z" />
              </svg>
              <span className="text-[11px] uppercase tracking-widest text-brand-textDim">Terminal</span>
              <span className="text-[10px] text-brand-textDim/70">⌘J / Esc</span>
            </div>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setUserClosed(true);
              }}
              className="flex h-7 w-7 items-center justify-center rounded-full text-brand-textDim transition hover:bg-brand-surfaceHi hover:text-brand-text"
              aria-label="Close terminal"
              title="Close (Esc)"
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current">
                <path d="M18.3 5.71 12 12.01l-6.3-6.3-1.41 1.41 6.3 6.3-6.3 6.3 1.41 1.41 6.3-6.3 6.3 6.3 1.41-1.41-6.3-6.3 6.3-6.3z" />
              </svg>
            </button>
          </div>
          <div className="min-h-0 flex-1">
            <TerminalPanel />
          </div>
        </div>
      </div>
    </>
  );
}
