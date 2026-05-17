import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { createServer, type Server } from "node:http";
import type { PermissionDecision, PermissionRequestEvent } from "../src/types";

type MCPPermissionServerEvents = {
  request: [PermissionRequestEvent];
};

export type PermissionRequestPayload = PermissionRequestEvent;

export declare interface MCPPermissionServer {
  on<K extends keyof MCPPermissionServerEvents>(
    eventName: K,
    listener: (...args: MCPPermissionServerEvents[K]) => void
  ): this;
  off<K extends keyof MCPPermissionServerEvents>(
    eventName: K,
    listener: (...args: MCPPermissionServerEvents[K]) => void
  ): this;
  emit<K extends keyof MCPPermissionServerEvents>(eventName: K, ...args: MCPPermissionServerEvents[K]): boolean;
}

export class MCPPermissionServer extends EventEmitter {
  private server: Server | null = null;
  private port = 0;
  private readonly pending = new Map<string, (decision: PermissionDecision) => void>();

  async start(): Promise<number> {
    if (this.server) {
      return this.port;
    }

    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => {
        if (req.method !== "POST" || req.url !== "/approve") {
          res.statusCode = 404;
          res.end();
          return;
        }

        let body = "";
        req.on("data", (chunk) => {
          body += chunk;
        });
        req.on("end", async () => {
          try {
            const { agentId, agentName, toolName, input } = JSON.parse(body) as Omit<
              PermissionRequestEvent,
              "requestId"
            >;
            const requestId = randomUUID();
            const decision = await new Promise<PermissionDecision>((resolveDecision) => {
              this.pending.set(requestId, resolveDecision);
              this.emit("request", { requestId, agentId, agentName, toolName, input });
            });

            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(decision));
          } catch (error) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ allowed: false, reason: String(error) }));
          }
        });
      });

      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (address && typeof address === "object") {
          this.port = address.port;
          this.server = server;
          resolve(this.port);
          return;
        }

        reject(new Error("Failed to start MCP permission server"));
      });
      server.on("error", reject);
    });
  }

  respond(requestId: string, decision: PermissionDecision): boolean {
    const resolver = this.pending.get(requestId);
    if (!resolver) {
      return false;
    }

    this.pending.delete(requestId);
    resolver(decision);
    return true;
  }

  getPort(): number {
    return this.port;
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    await new Promise<void>((resolve) => {
      this.server?.close(() => resolve());
    });
    this.server = null;
    this.port = 0;
  }
}
