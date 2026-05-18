import { execFile, type ExecFileException } from "node:child_process";
import { promisify } from "node:util";
import type { SetupCheckResult, ToolInfo } from "../src/types";

const exec = promisify(execFile);

const checks: Array<Omit<ToolInfo, "available" | "version">> = [
  {
    name: "node",
    category: "required",
    why: "MAO runtime (Electron + Vite).",
    install: {
      darwin: "brew install node",
      win32: "winget install OpenJS.NodeJS",
      linux: "sudo apt install nodejs npm"
    }
  },
  {
    name: "tmux",
    category: "required",
    why: "Backend for all interactive-mode agents.",
    install: {
      darwin: "brew install tmux",
      win32: "wsl --install -d Ubuntu  # then  sudo apt install tmux  (tmux requires WSL on Windows)",
      linux: "sudo apt install tmux"
    }
  },
  {
    name: "ttyd",
    category: "required",
    why: "Renders the tmux session as the embedded web terminal.",
    install: {
      darwin: "brew install ttyd",
      win32: "wsl --install -d Ubuntu  # then  sudo apt install ttyd",
      linux: "sudo apt install ttyd  # or build from https://github.com/tsl0922/ttyd"
    }
  },
  {
    name: "claude",
    category: "optional",
    why: "claude agents.",
    install: {
      darwin: "npm install -g @anthropic-ai/claude-code",
      win32: "npm install -g @anthropic-ai/claude-code",
      linux: "npm install -g @anthropic-ai/claude-code"
    }
  },
  {
    name: "codex",
    category: "optional",
    why: "codex agents.",
    install: {
      darwin: "see https://github.com/openai/codex",
      win32: "see https://github.com/openai/codex",
      linux: "see https://github.com/openai/codex"
    }
  },
  {
    name: "gemini",
    category: "optional",
    why: "gemini agents.",
    install: {
      darwin: "npm install -g @google/gemini-cli",
      win32: "npm install -g @google/gemini-cli",
      linux: "npm install -g @google/gemini-cli"
    }
  },
  {
    name: "grok",
    category: "optional",
    why: "grok agents.",
    install: {
      darwin: "xAI's grok-cli (project-specific)",
      win32: "xAI's grok-cli (project-specific)",
      linux: "xAI's grok-cli (project-specific)"
    }
  }
];

async function probe(name: string): Promise<{ available: boolean; version: string | null }> {
  const finder = process.platform === "win32" ? "where" : "which";

  try {
    await exec(finder, [name]);
  } catch (error) {
    const execError = error as ExecFileException;
    if (execError.code === "ENOENT" || (typeof execError.code === "number" && execError.code !== 0)) {
      return { available: false, version: null };
    }

    return { available: false, version: null };
  }

  try {
    const { stdout } = await exec(name, ["--version"], { timeout: 3000 });
    return { available: true, version: stdout.split(/\r?\n/)[0]?.trim() || null };
  } catch {
    return { available: true, version: null };
  }
}

export async function runSetupCheck(): Promise<SetupCheckResult> {
  const tools: ToolInfo[] = [];

  for (const spec of checks) {
    const { available, version } = await probe(spec.name);
    tools.push({ ...spec, available, version });
  }

  return {
    platform: process.platform,
    tools
  };
}
