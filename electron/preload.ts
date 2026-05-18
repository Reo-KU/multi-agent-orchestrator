import { contextBridge, ipcRenderer } from "electron";
import type {
  Agent,
  AgentHistoryEntry,
  AgentRunRequest,
  AgentRunResult,
  AgentSummary,
  GraphEdge,
  GraphNode,
  InstallProgress,
  InstallResult,
  PermissionDecision,
  PermissionRequestEvent,
  PtyDataEvent,
  PtyStatusEvent,
  SetupCheckResult,
  Task
} from "../src/types";

contextBridge.exposeInMainWorld("mao", {
  agent: {
    list: (): Promise<Agent[]> => ipcRenderer.invoke("mao:agent:list"),
    save: (agent: Agent): Promise<Agent> => ipcRenderer.invoke("mao:agent:save", agent),
    delete: (id: string): Promise<void> => ipcRenderer.invoke("mao:agent:delete", id),
    run: (request: AgentRunRequest): Promise<AgentRunResult> => ipcRenderer.invoke("mao:agent:run", request),
    abort: (agentId: string): Promise<boolean> => ipcRenderer.invoke("mao:agent:abort", agentId),
    abortAll: (): Promise<boolean> => ipcRenderer.invoke("mao:agent:abortAll"),
    loadSummary: (agentId: string): Promise<AgentSummary | null> =>
      ipcRenderer.invoke("mao:agent:loadSummary", agentId),
    appendHistory: (agentId: string, entry: AgentHistoryEntry): Promise<void> =>
      ipcRenderer.invoke("mao:agent:appendHistory", agentId, entry)
  },
  project: {
    loadSummary: (): Promise<string> => ipcRenderer.invoke("mao:project:loadSummary"),
    saveSummary: (text: string): Promise<void> => ipcRenderer.invoke("mao:project:saveSummary", text)
  },
  graph: {
    load: (): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> => ipcRenderer.invoke("mao:graph:load"),
    save: (graph: { nodes: GraphNode[]; edges: GraphEdge[] }): Promise<void> =>
      ipcRenderer.invoke("mao:graph:save", graph)
  },
  task: {
    create: (task: Task): Promise<Task> => ipcRenderer.invoke("mao:task:create", task),
    list: (): Promise<Task[]> => ipcRenderer.invoke("mao:task:list")
  },
  pty: {
    spawn: (agentId: string): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke("mao:pty:spawn", agentId),
    write: (agentId: string, data: string): Promise<void> => ipcRenderer.invoke("mao:pty:write", agentId, data),
    kill: (agentId: string): Promise<void> => ipcRenderer.invoke("mao:pty:kill", agentId)
  },
  log: {
    append: (agentId: string, data: string): Promise<void> => ipcRenderer.invoke("mao:log:append", agentId, data)
  },
  tty: {
    getUrl: (): Promise<string | null> => ipcRenderer.invoke("mao:tty:getUrl")
  },
  tmux: {
    selectWindow: (agentId: string): Promise<boolean> => ipcRenderer.invoke("mao:tmux:selectWindow", agentId)
  },
  setup: {
    check: (): Promise<SetupCheckResult> => ipcRenderer.invoke("mao:setup:check"),
    install: (toolName: string): Promise<InstallResult> => ipcRenderer.invoke("mao:setup:install", toolName),
    installCancel: (toolName: string): Promise<boolean> => ipcRenderer.invoke("mao:setup:installCancel", toolName),
    onInstallProgress: (callback: (progress: InstallProgress) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: InstallProgress): void => {
        callback(payload);
      };

      ipcRenderer.on("mao:setup:installProgress", listener);
      return () => ipcRenderer.off("mao:setup:installProgress", listener);
    }
  },
  permission: {
    respond: (requestId: string, decision: PermissionDecision): Promise<boolean> =>
      ipcRenderer.invoke("mao:permission:respond", requestId, decision),
    onRequest: (callback: (event: PermissionRequestEvent) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: PermissionRequestEvent): void => {
        callback(payload);
      };

      ipcRenderer.on("mao:permission:request", listener);
      return () => ipcRenderer.off("mao:permission:request", listener);
    }
  },
  onPtyData: (callback: (event: PtyDataEvent) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: PtyDataEvent): void => {
      callback(payload);
    };

    ipcRenderer.on("mao:pty:data", listener);
    return () => ipcRenderer.off("mao:pty:data", listener);
  },
  onPtyStatus: (callback: (event: PtyStatusEvent) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: PtyStatusEvent): void => {
      callback(payload);
    };

    ipcRenderer.on("mao:pty:status", listener);
    return () => ipcRenderer.off("mao:pty:status", listener);
  }
});
