import { app } from "electron";
import { join } from "node:path";

export const WORKSPACE_ROOT = join(
  app.getPath("home"),
  ".multi-agent-orchestrator",
  "workspaces",
  "default"
);

export const AGENTS_JSON_PATH = join(WORKSPACE_ROOT, "agents.json");
export const GRAPH_JSON_PATH = join(WORKSPACE_ROOT, "graph.json");
export const TASKS_JSON_PATH = join(WORKSPACE_ROOT, "tasks.json");
