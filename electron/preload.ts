import { contextBridge, ipcRenderer } from "electron";
import type { Agent, GraphEdge, GraphNode, PtyDataEvent, PtyStatusEvent, Task } from "../src/types";

contextBridge.exposeInMainWorld("mao", {
  agent: {
    list: (): Promise<Agent[]> => ipcRenderer.invoke("mao:agent:list"),
    save: (agent: Agent): Promise<Agent> => ipcRenderer.invoke("mao:agent:save", agent),
    delete: (id: string): Promise<void> => ipcRenderer.invoke("mao:agent:delete", id)
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
