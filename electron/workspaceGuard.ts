import path from "node:path";
import fs from "fs-extra";

export async function ensureMaoGitignore(workingDirectory: string): Promise<void> {
  try {
    const gitignorePath = path.join(workingDirectory, ".gitignore");
    const gitDirPath = path.join(workingDirectory, ".git");
    if (!(await fs.pathExists(gitDirPath))) {
      return;
    }

    const exists = await fs.pathExists(gitignorePath);
    const content = exists ? await fs.readFile(gitignorePath, "utf8") : "";
    if (/^\.mao\/?$/m.test(content)) {
      return;
    }

    const next =
      (content.endsWith("\n") || content.length === 0 ? content : `${content}\n`) +
      "# Added by Multi-Agent Orchestrator\n.mao/\n";
    await fs.writeFile(gitignorePath, next, "utf8");
  } catch {
    // Best effort only. Agents can still run if workspace metadata cannot be edited.
  }
}
