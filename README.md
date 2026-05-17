# Multi-Agent CLI Orchestrator

Electron + Vite + React + TypeScript scaffold for the Multi-Agent CLI Orchestrator MVP.

## Setup

```sh
npm install
```

## Development

```sh
npm run dev
```

Starts the Electron app with the Vite renderer dev server.

## Build

```sh
npm run build
```

Builds the Electron main, preload, and renderer output into `out/`.

## Distribution

```sh
npm run dist
```

Builds the app and packages it with electron-builder. The minimal targets are macOS `dmg` and Windows `nsis`.

## Shared Contracts

Pane2 and Pane3 should import shared domain and IPC contract types from:

```ts
import type { Agent, GraphNode, GraphEdge, Task, Message, IpcChannels } from "./src/types";
```

Workspace JSON paths are defined in `src/utils/storage.ts` and point to:

```text
~/.multi-agent-orchestrator/workspaces/default/
```

## UI Walkthrough

- Project Summary: 左上の "Project Summary" ボタンから、プロジェクト全体の前提や方針を Markdown テキストとして編集できます。
- Agent History: Inspector の "直近の応答履歴" で、選択中エージェントの最近の入力、応答、dispatch 数を確認できます。
- Node glow: マインドマップ上のノードは状態に応じて光ります。starting は黄色、running はシアン、error は赤です。
- Terminal input: 最下部 Terminal は入力対応です。interactive mode の承認プロンプトや CLI 入力に直接応答できます。

## Permission Flags

- Codex: `--sandbox workspace-write`, `--dangerously-bypass-approvals-and-sandbox`
- Claude: `--permission-mode acceptEdits`, `--dangerously-skip-permissions`
- Grok/custom: 利用中 CLI のドキュメントに従って Args に追加してください。

## Permission Policy

Each agent has a `permissionPolicy` which MAO translates to the appropriate
CLI-specific flags at spawn time:

| Policy | codex | claude | gemini |
|---|---|---|---|
| `safe-auto` (default) | `--sandbox workspace-write` | `--permission-mode acceptEdits` | `--approval-mode auto_edit` |
| `yolo` | `--dangerously-bypass-approvals-and-sandbox` | `--dangerously-skip-permissions` | `--yolo` |
| `ask` | (no flags) | (no flags) | (no flags) |

`safe-auto` is the right default for most workflows: agents can edit files
inside the cwd but can't escape it or run network/shell side-effects without
prompting. `yolo` skips every prompt; only use it when you trust the task and
are prepared to clean up afterwards.

### `ask` (per-call approval) and how it differs by CLI

`ask` is the only policy where MAO can interpose itself between the model and
each dangerous tool call. The plumbing depends on what the CLI exposes:

| CLI | `ask` + `exec` | `ask` + `interactive` |
|---|---|---|
| **claude** | ✅ MAO modal. Each tool call (Write, Bash, etc.) pops a "⚠️ Permission Request" dialog with the tool name and input. Approve / Deny is forwarded to claude via its `--permission-prompt-tool` MCP hook. | ✅ Same modal; or the CLI's own TUI prompt in the bottom terminal if `--permission-prompt-tool` is not loaded. |
| **codex** | ⚠️ No per-call approval — codex `exec` is hard-wired to `approval: never`, and codex has no equivalent of claude's `--permission-prompt-tool`. The CLI silently denies anything that needs approval. Inspector shows a yellow warning for this combination. | ✅ codex's native TUI prompt appears in the bottom terminal. Click the active tab, type `y`/`n`/`1`/`2` to answer. |
| **gemini** | ⚠️ Same situation as codex — no programmatic hook. Inspector warns. | ✅ Gemini's TUI prompt appears in the bottom terminal; respond there. |
| **grok / custom** | ⚠️ CLI-specific. | ✅ If the CLI prints a prompt to its TUI, answer it from the bottom terminal. |

In short:

- "I want every privileged operation to pop a dialog" → use **claude** with
  `mode=exec` and `permissionPolicy=ask`. This is the cleanest experience.
- "I'm using codex or gemini and need approvals" → switch the agent to
  `mode=interactive`, then approve in the bottom terminal panel directly.
- "I want full automation with sandboxing" → leave `safe-auto` on, escalate
  individual agents to `yolo` only when needed.

## Troubleshooting

### node-pty: spawn-helper permission error

初回起動時に "spawn-helper: Permission denied" が出る場合は以下を実行:

```sh
chmod +x node_modules/node-pty/build/Release/spawn-helper
```

このコマンドは postinstall (electron-builder install-app-deps) で自動的に処理される。
解消しない場合は `npm rebuild node-pty` を手動実行してください。

### rollup: Cannot find module @rollup/rollup-darwin-arm64

npm の optional-dependencies バグが原因です。以下で解消します:

```sh
rm -rf node_modules package-lock.json
npm install
```

### esbuild: installed for another platform

PM/CI 環境とインストール環境の arch が異なる場合 (Rosetta 2 越しに npm install など) に発生。
両方のバイナリを optionalDependencies に明示して回避できます。

### Electron 起動時にウィンドウが開かない

- ポート競合の可能性: `lsof -i :5173` で確認
- dev mode は環境変数 `ELECTRON_RENDERER_URL` を使用
