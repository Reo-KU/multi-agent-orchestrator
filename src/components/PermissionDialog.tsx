import { useEffect, useState, type ReactElement } from "react";
import { getTranslations } from "../i18n";
import { useAppStore } from "../store/useAppStore";
import type { PermissionRequestEvent } from "../types";

type PendingRequest = PermissionRequestEvent & { receivedAt: number };

export default function PermissionDialog(): ReactElement | null {
  const locale = useAppStore((state) => state.locale);
  const t = getTranslations(locale);
  const nodes = useAppStore((state) => state.nodes);
  const agents = useAppStore((state) => state.agents);
  const [queue, setQueue] = useState<PendingRequest[]>([]);

  useEffect(() => {
    if (!window.mao?.permission?.onRequest) {
      return undefined;
    }

    return window.mao.permission.onRequest((event) => {
      setQueue((previous) => [...previous, { ...event, receivedAt: Date.now() }]);
    });
  }, []);

  const respond = async (requestId: string, allowed: boolean): Promise<void> => {
    await window.mao.permission?.respond(requestId, {
      allowed,
      reason: allowed ? undefined : "User denied via MAO UI"
    });
    setQueue((previous) => previous.filter((request) => request.requestId !== requestId));
  };

  if (queue.length === 0) {
    return null;
  }

  // ノード座標から計算すると React Flow の viewport (pan/zoom) で位置がずれて
  // 画面外に出ることがあるため、画面右上から縦積みする (notification 形式)。
  return (
    <div className="pointer-events-none fixed right-6 top-20 z-40 flex flex-col gap-3">
      {queue.map((request) => {
        const agent = agents.find((item) => item.id === request.agentId);
        return (
          <div
            key={request.requestId}
            className="pointer-events-auto w-[340px] rounded-2xl border border-brand-sunsetA/50 bg-brand-surface/95 p-4 shadow-2xl backdrop-blur-lg"
          >
            <div className="mb-2 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-brand-sunsetA animate-pulse" />
              <h3 className="text-sm font-semibold text-brand-text">
                {agent?.name ?? request.agentName}
              </h3>
              <span className="ml-auto text-[10px] uppercase tracking-widest text-brand-textDim">
                {t.permission.tag}
              </span>
            </div>
            <p className="mb-3 text-xs text-brand-textDim">{t.permission.body(request.toolName)}</p>
            <pre className="mb-3 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-brand-bg/60 p-2 font-mono text-[11px] text-brand-text">
              {JSON.stringify(request.input, null, 2)}
            </pre>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => void respond(request.requestId, false)}
                className="rounded-full border border-brand-line px-4 py-2 text-xs font-medium text-brand-textDim transition hover:border-brand-textDim hover:text-brand-text"
              >
                {t.permission.deny}
              </button>
              <button
                type="button"
                onClick={() => void respond(request.requestId, true)}
                className="rounded-full bg-gradient-to-br from-brand-sunsetA to-brand-sunsetB px-4 py-2 text-xs font-semibold text-white shadow-[0_0_24px_rgba(255,61,138,0.4)] transition hover:brightness-110"
              >
                {t.permission.approve}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
