import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import type { InstallEvent } from "../src/types";

type InstallerEvents = {
  event: [{ toolName: string; event: InstallEvent }];
};

export declare interface Installer {
  on<K extends keyof InstallerEvents>(eventName: K, listener: (...args: InstallerEvents[K]) => void): this;
  off<K extends keyof InstallerEvents>(eventName: K, listener: (...args: InstallerEvents[K]) => void): this;
  emit<K extends keyof InstallerEvents>(eventName: K, ...args: InstallerEvents[K]): boolean;
}

export class Installer extends EventEmitter {
  private readonly active = new Map<string, AbortController>();

  async run(toolName: string, command: string, args: string[]): Promise<{ code: number | null }> {
    if (this.active.has(toolName)) {
      throw new Error(`${toolName} install is already running`);
    }

    const controller = new AbortController();
    this.active.set(toolName, controller);

    return new Promise((resolve) => {
      const child = spawn(command, args, {
        env: process.env,
        signal: controller.signal
      });

      child.stdout?.on("data", (chunk: Buffer) => {
        this.emit("event", { toolName, event: { type: "stdout", chunk: chunk.toString("utf8") } });
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        this.emit("event", { toolName, event: { type: "stderr", chunk: chunk.toString("utf8") } });
      });
      child.on("exit", (code) => {
        this.active.delete(toolName);
        this.emit("event", { toolName, event: { type: "exit", code } });
        resolve({ code });
      });
      child.on("error", (error) => {
        this.active.delete(toolName);
        this.emit("event", { toolName, event: { type: "stderr", chunk: String(error) } });
        this.emit("event", { toolName, event: { type: "exit", code: 1 } });
        resolve({ code: 1 });
      });
    });
  }

  cancel(toolName: string): boolean {
    const controller = this.active.get(toolName);
    if (!controller) {
      return false;
    }

    controller.abort();
    return true;
  }
}
