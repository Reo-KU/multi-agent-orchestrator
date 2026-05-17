import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, type IPty } from "node-pty";
import type { Agent, PtyDataEvent, PtyStatusEvent } from "../src/types";

type PtyExitEvent = {
  agentId: string;
  exitCode: number;
  signal?: number;
};

type ManagedPty = {
  agent: Agent;
  process: IPty;
  status: Agent["status"];
};

type PtyManagerEvents = {
  data: [PtyDataEvent];
  exit: [PtyExitEvent];
  status: [PtyStatusEvent];
};

const ALLOWED_COMMANDS = new Set([
  "claude",
  "codex",
  "grok",
  "sh",
  "bash",
  "zsh",
  "python",
  "python3",
  "node"
]);

const getCommandName = (command: string): string => {
  const normalized = command.trim();
  const parts = normalized.split(/[\\/]/);
  return parts[parts.length - 1] ?? normalized;
};

export declare interface PtyManager {
  on<K extends keyof PtyManagerEvents>(eventName: K, listener: (...args: PtyManagerEvents[K]) => void): this;
  off<K extends keyof PtyManagerEvents>(eventName: K, listener: (...args: PtyManagerEvents[K]) => void): this;
  emit<K extends keyof PtyManagerEvents>(eventName: K, ...args: PtyManagerEvents[K]): boolean;
}

export class PtyManager extends EventEmitter {
  private readonly processes = new Map<string, ManagedPty>();

  spawn(agent: Agent): { ok: true; process: IPty } | { ok: false; error: string } {
    const existing = this.processes.get(agent.id);

    if (existing) {
      return { ok: true, process: existing.process };
    }

    this.setStatus(agent.id, "starting");

    const absDir = path.resolve(agent.workingDirectory);

    if (!fs.existsSync(absDir)) {
      const error = `Working directory does not exist: ${absDir}`;
      this.setStatus(agent.id, "error");
      return { ok: false, error };
    }

    const home = os.homedir();
    if (!absDir.startsWith(home) && absDir !== "/tmp") {
      console.warn(`[PtyManager] Working directory outside home: ${absDir}`);
      // MVP only warns here. A confirmation dialog should gate this later.
    }

    const commandName = getCommandName(agent.command);
    if (!ALLOWED_COMMANDS.has(commandName)) {
      this.setStatus(agent.id, "error");
      return { ok: false, error: `Command not in allowlist: ${commandName}` };
    }

    try {
      const ptyProcess = spawn(agent.command, agent.args ?? [], {
        name: "xterm-256color",
        cwd: absDir,
        env: process.env as Record<string, string>,
        cols: 120,
        rows: 32
      });

      this.processes.set(agent.id, {
        agent,
        process: ptyProcess,
        status: "running"
      });

      ptyProcess.onData((data) => {
        this.emit("data", { agentId: agent.id, data });
      });

      ptyProcess.onExit(({ exitCode, signal }) => {
        this.processes.delete(agent.id);
        this.emit("exit", { agentId: agent.id, exitCode, signal });
        this.setStatus(agent.id, "stopped");
      });

      this.setStatus(agent.id, "running");
      return { ok: true, process: ptyProcess };
    } catch (error) {
      this.processes.delete(agent.id);
      this.setStatus(agent.id, "error");
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  write(agentId: string, data: string): void {
    const managed = this.processes.get(agentId);
    if (!managed) {
      return;
    }

    managed.process.write(data);
  }

  has(agentId: string): boolean {
    return this.processes.has(agentId);
  }

  kill(agentId: string): void {
    const managed = this.processes.get(agentId);
    if (!managed) {
      this.setStatus(agentId, "stopped");
      return;
    }

    try {
      managed.process.kill();
    } finally {
      this.processes.delete(agentId);
      this.setStatus(agentId, "stopped");
    }
  }

  killAll(): void {
    for (const agentId of [...this.processes.keys()]) {
      this.kill(agentId);
    }
  }

  private setStatus(agentId: string, status: Agent["status"]): void {
    const managed = this.processes.get(agentId);
    if (managed) {
      managed.status = status;
    }

    this.emit("status", { agentId, status });
  }
}

export const createShellTestAgent = (): Agent => ({
  id: "test",
  name: "Test Bash",
  type: "custom",
  command: "/bin/bash",
  args: ["-lc", "echo hello && sleep 60"],
  workingDirectory: os.homedir(),
  role: "PTY smoke test",
  systemPrompt: "",
  status: "stopped"
});
