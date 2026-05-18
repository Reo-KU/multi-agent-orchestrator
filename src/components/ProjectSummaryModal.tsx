import { useEffect, useState, type ReactElement } from "react";
import { getTranslations } from "../i18n";
import { useAppStore } from "../store/useAppStore";

type ProjectSummaryModalProps = {
  onClose: () => void;
};

export default function ProjectSummaryModal({ onClose }: ProjectSummaryModalProps): ReactElement {
  const locale = useAppStore((state) => state.locale);
  const t = getTranslations(locale);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    window.mao.project
      .loadSummary()
      .then((summary) => {
        if (active) {
          setText(summary ?? "");
        }
      })
      .catch((caught) => {
        if (active) {
          setError(caught instanceof Error ? caught.message : t.projectSummary.loadError);
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      await window.mao.project.saveSummary(text);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.projectSummary.saveError);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-4">
      <div className="w-full max-w-3xl rounded border border-slate-700 bg-slate-900 shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <h2 className="text-sm font-semibold">{t.projectSummary.title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-sm text-slate-300 hover:bg-slate-800"
          >
            {t.projectSummary.close}
          </button>
        </div>

        <div className="grid gap-3 p-5">
          {loading ? <p className="text-sm text-slate-400">{t.projectSummary.loading}</p> : null}
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            className="min-h-[400px] rounded border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm outline-none focus:border-cyan-500"
            placeholder={t.projectSummary.placeholder}
          />
          {error ? <p className="text-sm text-red-300">{error}</p> : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-800 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-700 px-3 py-2 text-sm hover:bg-slate-800"
          >
            {t.projectSummary.cancel}
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="rounded bg-cyan-500 px-3 py-2 text-sm font-medium text-slate-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? t.projectSummary.saving : t.projectSummary.save}
          </button>
        </div>
      </div>
    </div>
  );
}
