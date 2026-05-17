import { randomBytes } from "node:crypto";
import { execFileSync, spawn as cpSpawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fs from "fs-extra";
import type { Agent, PtyDataEvent, PtyStatusEvent } from "../src/types";

const SESSION_NAME = "mao-orch";

type TmuxManagerEvents = {
  data: [PtyDataEvent];
  status: [PtyStatusEvent];
};

export declare interface TmuxManager {
  on<K extends keyof TmuxManagerEvents>(eventName: K, listener: (...args: TmuxManagerEvents[K]) => void): this;
  off<K extends keyof TmuxManagerEvents>(eventName: K, listener: (...args: TmuxManagerEvents[K]) => void): this;
  emit<K extends keyof TmuxManagerEvents>(eventName: K, ...args: TmuxManagerEvents[K]): boolean;
}

export class TmuxManager extends EventEmitter {
  private readonly agentToWindow = new Map<string, string>();
  private readonly tailProcs = new Map<string, ChildProcess>();
  private readonly logFiles = new Map<string, string>();

  private windowNameFor(agentId: string): string {
    return `agent-${agentId.replace(/[^A-Za-z0-9_-]/g, "").slice(-20)}`;
  }

  private tmux(args: string[]): string {
    try {
      return execFileSync("tmux", args, { encoding: "utf8" });
    } catch (error) {
      throw new Error(`tmux ${args.join(" ")} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private ensureSession(): void {
    try {
      execFileSync("tmux", ["has-session", "-t", SESSION_NAME], { stdio: "ignore" });
    } catch {
      this.tmux(["new-session", "-d", "-s", SESSION_NAME, "-n", "welcome", "-x", "200", "-y", "50"]);
    }
  }

  has(agentId: string): boolean {
    return this.agentToWindow.has(agentId);
  }

  spawn(agent: Agent): { ok: true } | { ok: false; error: string } {
    if (this.has(agent.id)) {
      return { ok: true };
    }

    try {
      this.ensureSession();
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }

    const windowName = this.windowNameFor(agent.id);
    const cwd = agent.workingDirectory || process.env.HOME || "/tmp";
    const fullCommand = [agent.command, ...(agent.args ?? [])].filter(Boolean).join(" ");

    try {
      this.tmux(["new-window", "-t", SESSION_NAME, "-n", windowName, "-c", cwd, fullCommand]);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }

    this.agentToWindow.set(agent.id, windowName);

    const logPath = join(tmpdir(), `mao_tmux_${agent.id.slice(-8)}_${randomBytes(4).toString("hex")}.log`);
    fs.ensureFileSync(logPath);
    this.logFiles.set(agent.id, logPath);

    try {
      this.tmux(["pipe-pane", "-o", "-t", `${SESSION_NAME}:${windowName}`, `cat >> "${logPath}"`]);
    } catch (error) {
      try {
        execFileSync("tmux", ["kill-window", "-t", `${SESSION_NAME}:${windowName}`], { stdio: "ignore" });
      } catch {
        // Best effort cleanup.
      }
      this.agentToWindow.delete(agent.id);
      this.logFiles.delete(agent.id);
      return { ok: false, error: `pipe-pane setup failed: ${error instanceof Error ? error.message : String(error)}` };
    }

    const tail = cpSpawn("tail", ["-F", "-n", "0", logPath], { stdio: ["ignore", "pipe", "pipe"] });
    tail.stdout?.on("data", (chunk: Buffer) => {
      this.emit("data", { agentId: agent.id, data: chunk.toString("utf8") });
    });
    tail.on("exit", () => {
      this.tailProcs.delete(agent.id);
    });
    this.tailProcs.set(agent.id, tail);

    this.emit("status", { agentId: agent.id, status: "running" });
    return { ok: true };
  }

  write(agentId: string, data: string): void {
    const windowName = this.agentToWindow.get(agentId);
    if (!windowName) {
      return;
    }

    const endsWithCarriageReturn = data.endsWith("\r");
    const body = endsWithCarriageReturn ? data.slice(0, -1) : data;

    if (body.length > 0) {
      const bufferId = `mao_${randomBytes(4).toString("hex")}`;
      const bufferFile = join(tmpdir(), `${bufferId}.txt`);
      fs.writeFileSync(bufferFile, body);

      try {
        this.tmux(["load-buffer", "-b", bufferId, bufferFile]);
        this.tmux(["paste-buffer", "-b", bufferId, "-t", `${SESSION_NAME}:${windowName}`, "-d"]);
      } finally {
        try {
          fs.unlinkSync(bufferFile);
        } catch {
          // Best effort cleanup.
        }
      }
    }

    if (endsWithCarriageReturn) {
      this.tmux(["send-keys", "-t", `${SESSION_NAME}:${windowName}`, "Enter"]);
    }
  }

  kill(agentId: string): void {
    const windowName = this.agentToWindow.get(agentId);
    if (windowName) {
      try {
        execFileSync("tmux", ["kill-window", "-t", `${SESSION_NAME}:${windowName}`], { stdio: "ignore" });
      } catch {
        // Window may already be gone.
      }
      this.agentToWindow.delete(agentId);
    }

    const tail = this.tailProcs.get(agentId);
    if (tail) {
      try {
        tail.kill();
      } catch {
        // Best effort cleanup.
      }
      this.tailProcs.delete(agentId);
    }

    const logFile = this.logFiles.get(agentId);
    if (logFile) {
      try {
        fs.unlinkSync(logFile);
      } catch {
        // Best effort cleanup.
      }
      this.logFiles.delete(agentId);
    }

    this.emit("status", { agentId, status: "stopped" });
  }

  killAll(): void {
    for (const tail of this.tailProcs.values()) {
      try {
        tail.kill();
      } catch {
        // Best effort cleanup.
      }
    }

    this.tailProcs.clear();
    this.logFiles.clear();
    this.agentToWindow.clear();

    try {
      execFileSync("tmux", ["kill-session", "-t", SESSION_NAME], { stdio: "ignore" });
    } catch {
      // Session may not exist.
    }
  }

  getSessionName(): string {
    return SESSION_NAME;
  }

  selectWindow(agentId: string): boolean {
    const windowName = this.agentToWindow.get(agentId);
    if (!windowName) {
      return false;
    }

    try {
      this.tmux(["select-window", "-t", `${SESSION_NAME}:${windowName}`]);
      return true;
    } catch {
      return false;
    }
  }

  getAttachCommand(agentId: string): string | null {
    const windowName = this.agentToWindow.get(agentId);
    if (!windowName) {
      return null;
    }

    return `tmux attach -t ${SESSION_NAME}:${windowName}`;
  }
}
