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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-bg/70 px-4 backdrop-blur-sm">
      <div className="w-full max-w-3xl rounded border border-brand-line bg-brand-surface text-brand-text shadow-xl">
        <div className="flex items-center justify-between border-b border-brand-line px-5 py-4">
          <h2 className="text-sm font-semibold">{t.projectSummary.title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-sm text-brand-textDim hover:bg-brand-surfaceHi hover:text-brand-text"
          >
            {t.projectSummary.close}
          </button>
        </div>

        <div className="grid gap-3 p-5">
          {loading ? <p className="text-sm text-brand-textDim">{t.projectSummary.loading}</p> : null}
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            className="min-h-[400px] rounded border border-brand-line bg-brand-bg px-3 py-2 font-mono text-sm text-brand-text outline-none focus:border-brand-sunsetA"
            placeholder={t.projectSummary.placeholder}
          />
          {error ? <p className="text-sm text-brand-ember">{error}</p> : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-brand-line px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-brand-line px-3 py-2 text-sm text-brand-textDim hover:bg-brand-surfaceHi hover:text-brand-text"
          >
            {t.projectSummary.cancel}
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="rounded bg-gradient-to-br from-brand-sunsetA to-brand-sunsetB px-3 py-2 text-sm font-medium text-white hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? t.projectSummary.saving : t.projectSummary.save}
          </button>
        </div>
      </div>
    </div>
  );
}
