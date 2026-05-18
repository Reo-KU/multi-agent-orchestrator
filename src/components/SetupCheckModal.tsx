import { useEffect, useState, type ReactElement } from "react";
import { getTranslations } from "../i18n";
import { useAppStore } from "../store/useAppStore";
import type { SetupCheckResult, ToolInfo } from "../types";

type Props = {
  result: SetupCheckResult;
  onDismiss: () => void;
  onRecheck: () => void;
  rechecking: boolean;
};

type InstallState = {
  inProgress: boolean;
  output: string[];
  exitCode: number | null;
};

const emptyInstallState: InstallState = { inProgress: false, output: [], exitCode: null };

export default function SetupCheckModal({ result, onDismiss, onRecheck, rechecking }: Props): ReactElement {
  const locale = useAppStore((state) => state.locale);
  const t = getTranslations(locale);
  const [installState, setInstallState] = useState<Record<string, InstallState>>({});
  const required = result.tools.filter((tool) => tool.category === "required");
  const optional = result.tools.filter((tool) => tool.category === "optional");
  const missingRequired = required.filter((tool) => !tool.available);

  useEffect(() => {
    if (!window.mao.setup.onInstallProgress) return;
    return window.mao.setup.onInstallProgress(({ toolName, event }) => {
      setInstallState((previous) => {
        const current = previous[toolName] ?? emptyInstallState;
        if (event.type === "stdout" || event.type === "stderr") {
          return { ...previous, [toolName]: { ...current, output: [...current.output, event.chunk] } };
        }
        if (event.type === "exit") {
          return { ...previous, [toolName]: { ...current, inProgress: false, exitCode: event.code ?? -1 } };
        }
        return previous;
      });
    });
  }, []);

  const installCmd = (tool: ToolInfo): string => {
    const key = (["darwin", "win32", "linux"] as const).find((candidate) => candidate === result.platform) ?? "linux";
    return tool.install[key];
  };

  const startInstall = async (toolName: string): Promise<void> => {
    if (!window.mao.setup.install) return;
    setInstallState((previous) => ({
      ...previous,
      [toolName]: { inProgress: true, output: [], exitCode: null }
    }));
    const installResult = await window.mao.setup.install(toolName);
    if (!installResult.ok) {
      setInstallState((previous) => {
        const current = previous[toolName] ?? emptyInstallState;
        return {
          ...previous,
          [toolName]: {
            ...current,
            inProgress: false,
            exitCode: -1,
            output: [...current.output, `\n${installResult.error}`]
          }
        };
      });
      return;
    }
    window.setTimeout(() => void onRecheck(), 500);
  };

  const platformText =
    result.platform === "darwin"
      ? t.setup.platformMac
      : result.platform === "win32"
        ? t.setup.platformWin
        : t.setup.platformLinux;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-brand-bg/85 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded border border-brand-line bg-brand-surface text-brand-text shadow-2xl">
        <div className="shrink-0 border-b border-brand-line px-5 py-3">
          <h2 className="text-base font-semibold text-brand-text">{t.setup.title}</h2>
          <p className="mt-1 text-xs text-brand-textDim">{platformText}</p>
          <p className="mt-1 text-xs text-brand-textDim">{t.setup.installGuide}</p>
          <p className="mt-1 text-xs text-brand-textDim">{t.setup.maoWorkspaceHint}</p>
        </div>

        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-5 text-sm">
          {missingRequired.length > 0 ? (
            <p className="rounded border border-brand-ember/40 bg-brand-ember/10 p-3 text-brand-ember">
              {t.setup.missingRequired(missingRequired.length)}
            </p>
          ) : (
            <p className="rounded border border-brand-aurora/40 bg-brand-aurora/10 p-3 text-brand-aurora">
              {t.setup.allRequiredOk}
            </p>
          )}

          <section>
            <h3 className="text-xs uppercase tracking-wide text-brand-textDim">{t.setup.requiredHeader}</h3>
            <div className="mt-2 grid gap-2">
              {required.map((tool) => (
                <ToolRow
                  key={tool.name}
                  tool={tool}
                  cmd={installCmd(tool)}
                  state={installState[tool.name] ?? emptyInstallState}
                  onInstall={startInstall}
                  t={t}
                />
              ))}
            </div>
          </section>

          {optional.length > 0 ? (
            <section>
              <h3 className="text-xs uppercase tracking-wide text-brand-textDim">{t.setup.optionalHeader}</h3>
              <div className="mt-2 grid gap-2">
                {optional.map((tool) => (
                  <ToolRow
                    key={tool.name}
                    tool={tool}
                    cmd={installCmd(tool)}
                    state={installState[tool.name] ?? emptyInstallState}
                    onInstall={startInstall}
                    t={t}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-brand-line px-5 py-3">
          <button
            type="button"
            onClick={onRecheck}
            disabled={rechecking}
            className="rounded border border-brand-line px-3 py-2 text-sm text-brand-textDim hover:bg-brand-surfaceHi hover:text-brand-text disabled:opacity-50"
          >
            {rechecking ? t.setup.rechecking : t.setup.recheck}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="rounded bg-gradient-to-br from-brand-sunsetA to-brand-sunsetB px-3 py-2 text-sm font-medium text-white hover:brightness-105"
          >
            {missingRequired.length > 0 ? t.setup.continueAnyway : t.setup.close}
          </button>
        </div>
      </div>
    </div>
  );
}

function ToolRow({
  tool,
  cmd,
  state,
  onInstall,
  t
}: {
  tool: ToolInfo;
  cmd: string;
  state: InstallState;
  onInstall: (toolName: string) => Promise<void>;
  t: ReturnType<typeof getTranslations>;
}): ReactElement {
  const copy = (): void => {
    void navigator.clipboard.writeText(cmd);
  };
  const installable = tool.autoInstall != null && !tool.available && Boolean(window.mao.setup.install);

  return (
    <div className="rounded border border-brand-line bg-brand-bg p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className={tool.available ? "text-brand-aurora" : "text-brand-ember"}>{tool.available ? "✓" : "✗"}</span>
          <span className="font-mono text-sm">{tool.name}</span>
          {tool.version ? <span className="truncate text-[11px] text-brand-textDim">{tool.version}</span> : null}
        </div>
        <span className="max-w-[55%] truncate text-right text-[11px] text-brand-textDim" title={tool.why}>
          {tool.why}
        </span>
      </div>
      {!tool.available ? (
        <>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 truncate rounded bg-brand-surfaceHi px-2 py-1 font-mono text-xs text-brand-violet" title={cmd}>
              {cmd}
            </code>
            <button
              type="button"
              onClick={copy}
              className="rounded border border-brand-line px-2 py-1 text-xs text-brand-textDim hover:bg-brand-surfaceHi hover:text-brand-text"
            >
              {t.setup.copy}
            </button>
            {installable ? (
              <button
                type="button"
                onClick={() => void onInstall(tool.name)}
                disabled={state.inProgress}
                className="rounded bg-gradient-to-br from-brand-sunsetA to-brand-sunsetB px-2.5 py-1 text-xs font-medium text-white hover:brightness-105 disabled:cursor-not-allowed disabled:bg-brand-surfaceHi disabled:text-brand-textDim"
              >
                {state.inProgress ? t.setup.installing : t.setup.install}
              </button>
            ) : null}
          </div>
          {state.output.length > 0 ? (
            <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded border border-brand-line bg-brand-surface p-2 font-mono text-[11px] text-brand-text">
              {state.output.join("")}
            </pre>
          ) : null}
          {state.exitCode !== null ? (
            <p className={`mt-1 text-[11px] ${state.exitCode === 0 ? "text-brand-aurora" : "text-brand-ember"}`}>
              {state.exitCode === 0 ? t.setup.installSuccess : t.setup.installFailed(state.exitCode)}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
