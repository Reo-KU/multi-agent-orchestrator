import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";

const TTYD_BIN = "/usr/local/bin/ttyd";

export class TtydManager {
  private process: ChildProcess | null = null;
  private port: number | null = null;
  private starting: Promise<number> | null = null;

  async start(tmuxSession: string): Promise<number> {
    if (this.port) {
      return this.port;
    }

    if (this.starting) {
      return this.starting;
    }

    this.starting = (async () => {
      const port = await this.findFreePort();
      const args = [
        "-p",
        String(port),
        "-W",
        "-t",
        "fontSize=12",
        "-t",
        'theme={"background":"#020617","foreground":"#e2e8f0"}',
        "--writable",
        "tmux",
        "attach-session",
        "-t",
        tmuxSession
      ];
      const proc = spawn(TTYD_BIN, args, { stdio: ["ignore", "pipe", "pipe"] });

      proc.stderr?.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        if (text.includes("listening")) {
          // ttyd is ready.
        }
      });
      proc.on("exit", () => {
        this.process = null;
        this.port = null;
        this.starting = null;
      });

      await new Promise((resolve) => setTimeout(resolve, 800));
      this.process = proc;
      this.port = port;
      console.log(`[ttyd] listening on http://127.0.0.1:${port}/ -> tmux ${tmuxSession}`);
      return port;
    })();

    return this.starting;
  }

  getUrl(): string | null {
    if (!this.port) {
      return null;
    }

    return `http://127.0.0.1:${this.port}/`;
  }

  stop(): void {
    if (this.process) {
      try {
        this.process.kill();
      } catch {
        // Best effort shutdown.
      }
      this.process = null;
    }

    this.port = null;
    this.starting = null;
  }

  private findFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = createServer();
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (address && typeof address === "object") {
          const { port } = address;
          server.close(() => resolve(port));
          return;
        }

        reject(new Error("no port"));
      });
      server.on("error", reject);
    });
  }
}
