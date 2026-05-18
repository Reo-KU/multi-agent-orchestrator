import { useEffect, useRef, useState, type ReactElement } from "react";
import type { AgentLocale } from "../types";

type GearMenuProps = {
  onOpenProjectSummary: () => void;
  onOpenSetup: () => void;
  locale: AgentLocale;
  onLocaleChange: (locale: AgentLocale) => void;
};

export default function GearMenu({
  onOpenProjectSummary,
  onOpenSetup,
  locale,
  onLocaleChange
}: GearMenuProps): ReactElement {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key === ".") {
        event.preventDefault();
        setOpen((current) => !current);
      } else if (event.key === "Escape") {
        setOpen(false);
      }
    };
    const onDoc = (event: MouseEvent): void => {
      if (!ref.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDoc);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDoc);
    };
  }, []);

  return (
    <div ref={ref} className="fixed left-5 top-5 z-40 flex items-center gap-3">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex h-10 w-10 items-center justify-center rounded-full border border-brand-line bg-brand-surface/80 text-brand-text shadow-xl backdrop-blur transition hover:bg-brand-surfaceHi"
        aria-label="Menu"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden="true">
          <path d="M19.43 12.98c.04-.32.07-.66.07-.98s-.03-.66-.07-.98l2.11-1.65a.5.5 0 0 0 .12-.64l-2-3.46a.5.5 0 0 0-.61-.22l-2.49 1a7.46 7.46 0 0 0-1.7-.98l-.38-2.65A.5.5 0 0 0 14 2h-4a.5.5 0 0 0-.5.42l-.38 2.65c-.61.25-1.17.58-1.7.98l-2.49-1a.5.5 0 0 0-.61.22l-2 3.46a.5.5 0 0 0 .12.64L4.57 11c-.04.32-.07.66-.07.98s.03.66.07.98L2.46 14.63a.5.5 0 0 0-.12.64l2 3.46c.14.24.42.34.66.24l2.44-1c.53.4 1.09.73 1.7.98l.38 2.65a.5.5 0 0 0 .5.42h4a.5.5 0 0 0 .5-.42l.38-2.65c.61-.25 1.17-.58 1.7-.98l2.44 1c.24.1.52 0 .66-.24l2-3.46a.5.5 0 0 0-.12-.64L19.43 13ZM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z" />
        </svg>
      </button>
      <span className="text-[10px] font-medium tracking-[0.35em] text-brand-textDim">MAO</span>

      {open ? (
        <div className="absolute left-0 top-12 w-56 rounded-xl border border-brand-line bg-brand-surface/95 p-1.5 shadow-2xl backdrop-blur-lg">
          <button
            type="button"
            onClick={() => {
              onOpenProjectSummary();
              setOpen(false);
            }}
            className="w-full rounded-lg px-3 py-2 text-left text-sm text-brand-text hover:bg-brand-surfaceHi"
          >
            Project Summary
          </button>
          <button
            type="button"
            onClick={() => {
              onOpenSetup();
              setOpen(false);
            }}
            className="w-full rounded-lg px-3 py-2 text-left text-sm text-brand-text hover:bg-brand-surfaceHi"
          >
            Setup Check
          </button>
          <div className="my-1.5 border-t border-brand-line" />
          <div className="px-3 py-2 text-[10px] uppercase tracking-widest text-brand-textDim">Language</div>
          <button
            type="button"
            onClick={() => {
              onLocaleChange("en");
              setOpen(false);
            }}
            className={`w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-brand-surfaceHi ${
              locale === "en" ? "text-brand-sunsetA" : "text-brand-text"
            }`}
          >
            English
          </button>
          <button
            type="button"
            onClick={() => {
              onLocaleChange("ja");
              setOpen(false);
            }}
            className={`w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-brand-surfaceHi ${
              locale === "ja" ? "text-brand-sunsetA" : "text-brand-text"
            }`}
          >
            日本語
          </button>
          <div className="my-1.5 border-t border-brand-line" />
          <div className="px-3 py-2 font-mono text-[10px] text-brand-textDim">tmux attach -t mao-orch</div>
        </div>
      ) : null}
    </div>
  );
}
