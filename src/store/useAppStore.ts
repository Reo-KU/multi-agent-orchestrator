import { create } from "zustand";
import type { Agent, GraphEdge, GraphNode, Task } from "../types";

type AppState = {
  agents: Agent[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  tasks: Task[];
};

export const useAppStore = create<AppState>(() => ({
  agents: [],
  nodes: [],
  edges: [],
  tasks: []
}));
