import { app, BrowserWindow, ipcMain } from "electron";
import fs from "fs-extra";
import { join } from "node:path";
import { z } from "zod";
import type {
  Agent,
  AgentHistoryEntry,
  AgentRunRequest,
  AgentRunResult,
  AgentSummary,
  GraphEdge,
  GraphNode,
  IpcChannels,
  InstallResult,
  PermissionDecision,
  Task
} from "../src/types";
import {
  AGENT_HISTORY_PATH,
  AGENTS_JSON_PATH,
  GRAPH_JSON_PATH,
  PROJECT_SUMMARY_PATH,
  TASKS_JSON_PATH,
  WORKSPACE_ROOT
} from "../src/utils/storage";
import { maskSecrets } from "../src/utils/maskSecrets";
import { AgentRunner } from "./agentRunner";
import { Installer } from "./installer";
import { MCPPermissionServer } from "./mcpPermissionServer";
import { createShellTestAgent, PtyManager } from "./ptyManager";
import { runSetupCheck } from "./systemCheck";
import { TmuxManager } from "./tmuxManager";
import { TtydManager } from "./ttydManager";

const agentSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["claude", "codex", "grok", "gemini", "custom"]),
  mode: z.enum(["exec", "interactive"]).optional().default("interactive"),
  permissionPolicy: z.enum(["ask", "safe-auto", "yolo"]).optional().default("safe-auto"),
  command: z.string(),
  args: z.array(z.string()).optional(),
  workingDirectory: z.string(),
  role: z.string(),
  systemPrompt: z.string(),
  status: z.enum(["stopped", "starting", "running", "error"])
}) satisfies z.ZodType<Agent>;

const graphNodeSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  position: z.object({
    x: z.number(),
    y: z.number()
  }),
  isRoot: z.boolean()
}) satisfies z.ZodType<GraphNode>;

const graphEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string()
}) satisfies z.ZodType<GraphEdge>;

const graphSchema = z.object({
  nodes: z.array(graphNodeSchema),
  edges: z.array(graphEdgeSchema)
});

const taskSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  rootAgentId: z.string(),
  status: z.enum(["pending", "running", "completed", "failed"]),
  createdAt: z.string(),
  updatedAt: z.string()
}) satisfies z.ZodType<Task>;

const agentsSchema = z.array(agentSchema);
const tasksSchema = z.array(taskSchema);

const ptyManager = new PtyManager();
const tmuxManager = new TmuxManager();
const ttydManager = new TtydManager();
const installer = new Installer();
const agentRunner = new AgentRunner();
agentRunner.setPtyManager(tmuxManager);
const mcpPermissionServer = new MCPPermissionServer();
let didRunSmokeTest = false;
let didStartTtyd = false;
const writeLocks = new Map<string, Promise<void>>();

const ensureJsonFile = async <T>(path: string, fallback: T): Promise<void> => {
  if (!(await fs.pathExists(path))) {
    await fs.writeJson(path, fallback, { spaces: 2 });
  }
};

const readValidatedJson = async <T>(path: string, schema: z.ZodType<T>, fallback: T): Promise<T> => {
  try {
    await ensureJsonFile(path, fallback);
    const raw = await fs.readJson(path);
    const parsed = schema.safeParse(raw);

    if (parsed.success) {
      return parsed.data;
    }
  } catch (error) {
    console.warn(`[main] Failed to read JSON ${path}:`, error);
  }

  await fs.writeJson(path, fallback, { spaces: 2 });
  return fallback;
};

const writeJsonUnlocked = async <T>(path: string, value: T): Promise<void> => {
  await fs.ensureDir(WORKSPACE_ROOT);
  await fs.writeJson(path, value, { spaces: 2 });
};

const withFileLock = async <T>(path: string, operation: () => Promise<T>): Promise<T> => {
  const previous = writeLocks.get(path) ?? Promise.resolve();
  const next = previous.then(operation);
  writeLocks.set(
    path,
    next.then(
      () => undefined,
      () => undefined
    )
  );
  return next;
};

const serializedWriteJson = async <T>(path: string, value: T): Promise<void> =>
  withFileLock(path, () => writeJsonUnlocked(path, value));

const initializeStorage = async (): Promise<void> => {
  await fs.ensureDir(WORKSPACE_ROOT);
  await ensureJsonFile(AGENTS_JSON_PATH, []);
  await ensureJsonFile(GRAPH_JSON_PATH, { nodes: [], edges: [] });
  await ensureJsonFile(TASKS_JSON_PATH, []);
  await ensureJsonFile(AGENT_HISTORY_PATH, {});

  if (!(await fs.pathExists(PROJECT_SUMMARY_PATH))) {
    await fs.writeFile(
      PROJECT_SUMMARY_PATH,
      "# Project Summary\n\n(Describe the workspace here. This is injected at the top of every agent prompt.)\n",
      "utf8"
    );
  }

  await readValidatedJson(AGENTS_JSON_PATH, agentsSchema, []);
  await readValidatedJson(GRAPH_JSON_PATH, graphSchema, { nodes: [], edges: [] });
  await readValidatedJson(TASKS_JSON_PATH, tasksSchema, []);
};

const readAgents = (): Promise<Agent[]> => readValidatedJson(AGENTS_JSON_PATH, agentsSchema, []);
const readGraph = (): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> =>
  readValidatedJson(GRAPH_JSON_PATH, graphSchema, { nodes: [], edges: [] });
const readTasks = (): Promise<Task[]> => readValidatedJson(TASKS_JSON_PATH, tasksSchema, []);

const registerIpcHandlers = (): void => {
  ipcMain.handle("mao:agent:list" satisfies keyof IpcChannels, async (): ReturnType<IpcChannels["mao:agent:list"]> => {
    return readAgents();
  });

  ipcMain.handle(
    "mao:agent:save" satisfies keyof IpcChannels,
    async (_event, agent: Agent): ReturnType<IpcChannels["mao:agent:save"]> => {
      const parsed = agentSchema.parse(agent);
      await withFileLock(AGENTS_JSON_PATH, async () => {
        const agents = await readAgents();
        const existingIndex = agents.findIndex((item) => item.id === parsed.id);

        if (existingIndex >= 0) {
          agents[existingIndex] = parsed;
        } else {
          agents.push(parsed);
        }

        await writeJsonUnlocked(AGENTS_JSON_PATH, agents);
      });
      return parsed;
    }
  );

  ipcMain.handle(
    "mao:agent:delete" satisfies keyof IpcChannels,
    async (_event, id: string): ReturnType<IpcChannels["mao:agent:delete"]> => {
      await withFileLock(AGENTS_JSON_PATH, async () => {
        const agents = await readAgents();
        await writeJsonUnlocked(
          AGENTS_JSON_PATH,
          agents.filter((agent) => agent.id !== id)
        );
      });
      ptyManager.kill(id);
      tmuxManager.kill(id);
      agentRunner.kill(id);
    }
  );

  ipcMain.handle(
    "mao:agent:run" satisfies keyof IpcChannels,
    async (_event, request: AgentRunRequest): ReturnType<IpcChannels["mao:agent:run"]> => {
      const agents = await readAgents();
      const agent = agents.find((item) => item.id === request.agentId);

      if (!agent) {
        return { ok: false, error: `Agent not found: ${request.agentId}` } satisfies AgentRunResult;
      }

      const mode = agent.mode ?? "exec";
      if (mode === "exec") {
        return agentRunner.run(request, agent);
      }

      if (mode === "interactive") {
        return agentRunner.runInteractive(request, agent);
      }

      return { ok: false, error: `Unknown mode: ${mode}` } satisfies AgentRunResult;
    }
  );

  ipcMain.handle(
    "mao:agent:abort" satisfies keyof IpcChannels,
    async (_event, agentId: string): ReturnType<IpcChannels["mao:agent:abort"]> => {
      ptyManager.kill(agentId);
      tmuxManager.kill(agentId);
      return agentRunner.abort(agentId);
    }
  );

  ipcMain.handle(
    "mao:agent:abortAll" satisfies keyof IpcChannels,
    async (): ReturnType<IpcChannels["mao:agent:abortAll"]> => {
      agentRunner.abortAll();
      ptyManager.killAll();
      tmuxManager.killAll();
      return true;
    }
  );

  ipcMain.handle(
    "mao:agent:loadSummary" satisfies keyof IpcChannels,
    async (_event, agentId: string): ReturnType<IpcChannels["mao:agent:loadSummary"]> => {
      try {
        const history = (await fs.readJson(AGENT_HISTORY_PATH)) as Record<string, AgentHistoryEntry[]>;
        const list = history[agentId] ?? [];
        return {
          agentId,
          totalRuns: list.length,
          recentEntries: list.slice(-10)
        } satisfies AgentSummary;
      } catch {
        return null;
      }
    }
  );

  ipcMain.handle(
    "mao:agent:appendHistory" satisfies keyof IpcChannels,
    async (
      _event,
      agentId: string,
      entry: AgentHistoryEntry
    ): ReturnType<IpcChannels["mao:agent:appendHistory"]> => {
      await withFileLock(AGENT_HISTORY_PATH, async () => {
        let history: Record<string, AgentHistoryEntry[]> = {};

        try {
          history = (await fs.readJson(AGENT_HISTORY_PATH)) as Record<string, AgentHistoryEntry[]>;
        } catch {
          history = {};
        }

        history[agentId] = [...(history[agentId] ?? []), entry].slice(-50);
        await writeJsonUnlocked(AGENT_HISTORY_PATH, history);
      });
    }
  );

  ipcMain.handle(
    "mao:project:loadSummary" satisfies keyof IpcChannels,
    async (): ReturnType<IpcChannels["mao:project:loadSummary"]> => {
      try {
        return await fs.readFile(PROJECT_SUMMARY_PATH, "utf8");
      } catch {
        return "";
      }
    }
  );

  ipcMain.handle(
    "mao:project:saveSummary" satisfies keyof IpcChannels,
    async (_event, text: string): ReturnType<IpcChannels["mao:project:saveSummary"]> => {
      await fs.ensureDir(WORKSPACE_ROOT);
      await fs.writeFile(PROJECT_SUMMARY_PATH, text, "utf8");
    }
  );

  ipcMain.handle("mao:graph:load" satisfies keyof IpcChannels, async (): ReturnType<IpcChannels["mao:graph:load"]> => {
    return readGraph();
  });

  ipcMain.handle(
    "mao:graph:save" satisfies keyof IpcChannels,
    async (_event, graph: { nodes: GraphNode[]; edges: GraphEdge[] }): ReturnType<IpcChannels["mao:graph:save"]> => {
      const parsed = graphSchema.parse(graph);
      await serializedWriteJson(GRAPH_JSON_PATH, parsed);
    }
  );

  ipcMain.handle(
    "mao:task:create" satisfies keyof IpcChannels,
    async (_event, task: Task): ReturnType<IpcChannels["mao:task:create"]> => {
      const parsed = taskSchema.parse(task);
      await withFileLock(TASKS_JSON_PATH, async () => {
        const tasks = await readTasks();
        tasks.push(parsed);
        await writeJsonUnlocked(TASKS_JSON_PATH, tasks);
      });
      return parsed;
    }
  );

  ipcMain.handle("mao:task:list" satisfies keyof IpcChannels, async (): ReturnType<IpcChannels["mao:task:list"]> => {
    return readTasks();
  });

  ipcMain.handle(
    "mao:pty:spawn" satisfies keyof IpcChannels,
    async (_event, agentId: string): ReturnType<IpcChannels["mao:pty:spawn"]> => {
      const agents = await readAgents();
      const agent = agents.find((item) => item.id === agentId);

      if (!agent) {
        return { ok: false, error: `Agent not found: ${agentId}` };
      }

      const result = (agent.mode ?? "exec") === "interactive" ? tmuxManager.spawn(agent) : ptyManager.spawn(agent);
      if (!result.ok) {
        return { ok: false, error: result.error };
      }

      return { ok: true };
    }
  );

  ipcMain.handle(
    "mao:pty:write" satisfies keyof IpcChannels,
    async (_event, agentId: string, data: string): ReturnType<IpcChannels["mao:pty:write"]> => {
      if (ptyManager.has(agentId)) {
        ptyManager.write(agentId, data);
        return;
      }

      if (tmuxManager.has(agentId)) {
        tmuxManager.write(agentId, data);
        return;
      }

      agentRunner.write(agentId, data);
    }
  );

  ipcMain.handle(
    "mao:pty:kill" satisfies keyof IpcChannels,
    async (_event, agentId: string): ReturnType<IpcChannels["mao:pty:kill"]> => {
      if (ptyManager.has(agentId)) {
        ptyManager.kill(agentId);
        return;
      }

      if (tmuxManager.has(agentId)) {
        tmuxManager.kill(agentId);
        return;
      }

      agentRunner.kill(agentId);
    }
  );

  ipcMain.handle(
    "mao:log:append" satisfies keyof IpcChannels,
    async (_event, agentId: string, data: string): ReturnType<IpcChannels["mao:log:append"]> => {
      const logDir = join(WORKSPACE_ROOT, "logs");
      await fs.ensureDir(logDir);
      await fs.appendFile(join(logDir, `${agentId}.log`), data);
    }
  );

  ipcMain.handle(
    "mao:permission:respond" satisfies keyof IpcChannels,
    async (
      _event,
      requestId: string,
      decision: PermissionDecision
    ): ReturnType<IpcChannels["mao:permission:respond"]> => {
      return mcpPermissionServer.respond(requestId, decision);
    }
  );

  ipcMain.handle("mao:tty:getUrl" satisfies keyof IpcChannels, async (): ReturnType<IpcChannels["mao:tty:getUrl"]> => {
    return ttydManager.getUrl();
  });

  ipcMain.handle(
    "mao:tmux:selectWindow" satisfies keyof IpcChannels,
    async (_event, agentId: string): ReturnType<IpcChannels["mao:tmux:selectWindow"]> => {
      return tmuxManager.selectWindow(agentId);
    }
  );

  ipcMain.handle("mao:setup:check" satisfies keyof IpcChannels, async (): ReturnType<IpcChannels["mao:setup:check"]> => {
    return runSetupCheck();
  });

  ipcMain.handle(
    "mao:setup:install" satisfies keyof IpcChannels,
    async (_event, toolName: string): ReturnType<IpcChannels["mao:setup:install"]> => {
      const check = await runSetupCheck();
      const tool = check.tools.find((item) => item.name === toolName);

      if (!tool) {
        return { ok: false, error: `Unknown tool: ${toolName}` } satisfies InstallResult;
      }

      if (tool.available) {
        return { ok: true, alreadyInstalled: true } satisfies InstallResult;
      }

      if (!tool.autoInstall) {
        return {
          ok: false,
          error: `No auto-install available for ${toolName}. Please install manually.`
        } satisfies InstallResult;
      }

      try {
        const result = await installer.run(toolName, tool.autoInstall.command, tool.autoInstall.args);
        if (result.code === 0) {
          return { ok: true, exitCode: result.code } satisfies InstallResult;
        }

        return { ok: false, error: `${toolName} install failed with exit code ${result.code}` } satisfies InstallResult;
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) } satisfies InstallResult;
      }
    }
  );

  ipcMain.handle(
    "mao:setup:installCancel" satisfies keyof IpcChannels,
    async (_event, toolName: string): ReturnType<IpcChannels["mao:setup:installCancel"]> => {
      return installer.cancel(toolName);
    }
  );
};

const registerPtyBroadcasts = (): void => {
  ptyManager.on("data", ({ agentId, data }) => {
    const maskedData = maskSecrets(data);

    for (const browserWindow of BrowserWindow.getAllWindows()) {
      browserWindow.webContents.send("mao:pty:data", { agentId, data: maskedData });
    }

    if (agentId === "test") {
      console.log(`[PTY test:${agentId}] ${maskedData.trimEnd()}`);
    }
  });

  ptyManager.on("status", ({ agentId, status }) => {
    for (const browserWindow of BrowserWindow.getAllWindows()) {
      browserWindow.webContents.send("mao:pty:status", { agentId, status });
    }
  });

  tmuxManager.on("data", ({ agentId, data }) => {
    const maskedData = maskSecrets(data);

    for (const browserWindow of BrowserWindow.getAllWindows()) {
      browserWindow.webContents.send("mao:pty:data", { agentId, data: maskedData });
    }
  });

  tmuxManager.on("status", ({ agentId, status }) => {
    for (const browserWindow of BrowserWindow.getAllWindows()) {
      browserWindow.webContents.send("mao:pty:status", { agentId, status });
    }

    if (status === "running" && !didStartTtyd) {
      didStartTtyd = true;
      void ttydManager.start(tmuxManager.getSessionName()).catch((error) => {
        didStartTtyd = false;
        console.error("[ttyd] failed to start", error);
      });
    }
  });

  agentRunner.on("data", ({ agentId, data }) => {
    const maskedData = maskSecrets(data);

    for (const browserWindow of BrowserWindow.getAllWindows()) {
      browserWindow.webContents.send("mao:pty:data", { agentId, data: maskedData });
    }
  });

  agentRunner.on("status", ({ agentId, status }) => {
    for (const browserWindow of BrowserWindow.getAllWindows()) {
      browserWindow.webContents.send("mao:pty:status", { agentId, status });
    }
  });

  mcpPermissionServer.on("request", (payload) => {
    for (const browserWindow of BrowserWindow.getAllWindows()) {
      browserWindow.webContents.send("mao:permission:request", payload);
    }
  });

  installer.on("event", (payload) => {
    for (const browserWindow of BrowserWindow.getAllWindows()) {
      browserWindow.webContents.send("mao:setup:installProgress", payload);
    }
  });
};

const createWindow = (): void => {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: join(__dirname, "../preload/preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
    window.webContents.openDevTools({ mode: "detach" });
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }

  if (process.env.MAO_PTY_SMOKE_TEST === "1" && !didRunSmokeTest) {
    didRunSmokeTest = true;
    window.webContents.once("did-finish-load", () => {
      const result = ptyManager.spawn(createShellTestAgent());
      if (!result.ok) {
        console.warn(`[PTY test] ${result.error}`);
      }
    });
  }
};

app.whenReady().then(async () => {
  const mcpPort = await mcpPermissionServer.start();
  agentRunner.setMcpPort(mcpPort);
  console.log("[MAO] MCP permission server listening on port", mcpPort);
  await initializeStorage();
  registerIpcHandlers();
  registerPtyBroadcasts();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("will-quit", () => {
  ptyManager.killAll();
  tmuxManager.killAll();
  agentRunner.killAll();
  ttydManager.stop();
  void mcpPermissionServer.stop();
});
