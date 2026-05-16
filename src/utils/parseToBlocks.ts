import type { Agent } from "../types";

export type ToBlock = {
  agentName: string;
  agentId: string | null;
  body: string;
};

const toComparable = (value: string): string => value.trim().toLowerCase();

const stripAnsi = (input: string): string =>
  input
    // CSI sequences: ESC [ params intermediate-bytes final-byte
    .replace(/\x1b\[[0-9;?]*[\x20-\x2F]*[\x40-\x7E]/g, "")
    // OSC sequences: ESC ] ... BEL or ESC \
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    // 2-char ESC sequences (ESC ( B, ESC =, ESC >, etc.)
    .replace(/\x1b[()=><][\x20-\x7E]?/g, "")
    // DCS / APC / PM / SOS: ESC P ... ESC \ etc.
    .replace(/\x1b[PX^_][^\x1b]*\x1b\\/g, "")
    // Remaining standalone ESC bytes.
    .replace(/\x1b/g, "");

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
