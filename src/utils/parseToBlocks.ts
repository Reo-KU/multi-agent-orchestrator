import type { Agent } from "../types";
import { stripAnsi } from "./stripAnsi";

export type ToBlock = {
  agentName: string;
  agentId: string | null;
  body: string;
};

const toComparable = (value: string): string => value.trim().toLowerCase();

const resolveAgentId = (name: string, agents: Agent[]): string | null => {
  const target = toComparable(name);
  const exact = agents.find((agent) => toComparable(agent.name) === target);
  if (exact) {
    return exact.id;
  }

  const partial = agents.find((agent) => {
    const agentName = toComparable(agent.name);
    return agentName.includes(target) || target.includes(agentName);
  });

  return partial?.id ?? null;
};

export const parseToBlocks = (input: string, agents: Agent[]): ToBlock[] => {
  const clean = stripAnsi(input);
  const blocks: ToBlock[] = [];
  const pattern = /\[TO:\s*([^\]]+)\]\s*\n([\s\S]*?)(?=\n\s*\[TO:|$)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(clean)) !== null) {
    const agentName = match[1].trim();
    const body = match[2].trim();

    if (!agentName || !body) {
      continue;
    }

    blocks.push({
      agentName,
      agentId: resolveAgentId(agentName, agents),
      body
    });
  }

  return blocks;
};
