import { useEffect, useState, type ReactElement } from "react";
import type { PermissionRequestEvent } from "../types";

type PendingRequest = PermissionRequestEvent & { receivedAt: number };

export default function PermissionDialog(): ReactElement | null {
  const [queue, setQueue] = useState<PendingRequest[]>([]);
  const head = queue[0];

  useEffect(() => {
    if (!window.mao?.permission?.onRequest) {
      return undefined;
    }

    return window.mao.permission.onRequest((event) => {
      setQueue((previous) => [...previous, { ...event, receivedAt: Date.now() }]);
    });
  }, []);

  const respond = async (allowed: boolean): Promise<void> => {
    if (!head) {
      return;
    }

    await window.mao.permission?.respond(head.requestId, {
      allowed,
      reason: allowed ? undefined : "User denied via MAO UI"
    });
    setQueue((previous) => previous.slice(1));
  };

  if (!head) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/80 p-4">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded border border-yellow-700 bg-slate-900 shadow-2xl">
        <div className="shrink-0 border-b border-slate-800 px-5 py-3">
          <h2 className="text-sm font-semibold text-yellow-200">⚠️ Permission Request</h2>
        </div>
        <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto p-5 text-sm">
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">Agent</div>
            <div className="mt-1 font-medium">{head.agentName}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">Tool</div>
            <div className="mt-1 break-all font-mono text-cyan-300">{head.toolName}</div>
          </div>
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wide text-slate-500">Input</div>
            <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-all rounded border border-slate-800 bg-slate-950 p-3 text-xs text-slate-300">
              {JSON.stringify(head.input, null, 2)}
            </pre>
          </div>
          {queue.length > 1 ? (
            <p className="text-[11px] text-slate-500">+ {queue.length - 1} more pending</p>
          ) : null}
        </div>
        <div className="flex shrink-0 justify-end gap-2 border-t border-slate-800 px-5 py-3">
          <button
            type="button"
            onClick={() => void respond(false)}
            className="rounded border border-slate-700 px-3 py-2 text-sm hover:bg-slate-800"
          >
            Deny
          </button>
          <button
            type="button"
            onClick={() => void respond(true)}
            className="rounded bg-green-500 px-3 py-2 text-sm font-medium text-green-950 hover:bg-green-400"
          >
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}
