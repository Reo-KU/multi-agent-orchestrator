import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("mao", {});
