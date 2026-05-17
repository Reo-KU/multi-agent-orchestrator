#!/usr/bin/env node
import { stdin, stdout } from "node:process";

const MAO_PERM_PORT = process.env.MAO_PERM_PORT;
const MAO_AGENT_ID = process.env.MAO_AGENT_ID ?? "";
const MAO_AGENT_NAME = process.env.MAO_AGENT_NAME ?? "";

const send = (message) => {
  stdout.write(`${JSON.stringify(message)}\n`);
};

const tools = [
  {
    name: "approve_request",
    description: "Asks the user (via MAO UI) to approve or deny the requested action.",
    inputSchema: {
      type: "object",
      properties: {
        tool_name: { type: "string" },
        input: { type: "object" }
      },
      required: ["tool_name"]
    }
  }
];

const callApprove = async (toolName, input) => {
  const response = await fetch(`http://127.0.0.1:${MAO_PERM_PORT}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      agentId: MAO_AGENT_ID,
      agentName: MAO_AGENT_NAME,
      toolName,
      input
    })
  });

  return response.json();
};

const handle = async (message) => {
  if (message.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "maoperm", version: "0.1.0" }
      }
    });
    return;
  }

  if (message.method === "tools/list") {
    send({ jsonrpc: "2.0", id: message.id, result: { tools } });
    return;
  }

  if (message.method === "tools/call") {
    const { name, arguments: args } = message.params ?? {};
    if (name !== "approve_request") {
      send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "unknown tool" } });
      return;
    }

    try {
      const decision = await callApprove(args?.tool_name, args?.input ?? {});
      // Translate to claude's --permission-prompt-tool expected shape:
      //   { behavior: "allow", updatedInput }
      //   { behavior: "deny",  message }
      const claudeResponse = decision.allowed
        ? { behavior: "allow", updatedInput: args?.input ?? {} }
        : { behavior: "deny", message: decision.reason ?? "User denied via MAO UI" };
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          content: [{ type: "text", text: JSON.stringify(claudeResponse) }],
          isError: false
        }
      });
    } catch (error) {
      send({ jsonrpc: "2.0", id: message.id, error: { code: -32000, message: String(error) } });
    }
    return;
  }

  if (message.id !== undefined) {
    send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "unknown method" } });
  }
};

let buffer = "";
stdin.on("data", async (chunk) => {
  buffer += chunk.toString();
  let index;

  while ((index = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) {
      continue;
    }

    try {
      await handle(JSON.parse(line));
    } catch {
      // Ignore malformed JSON-RPC notifications.
    }
  }
});
