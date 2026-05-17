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

Agents can use a `permissionPolicy` to let MAO choose common approval flags.
`safe-auto` is the default and allows normal edit workflows such as cwd writes.
`ask` adds no approval flags and leaves prompts to the CLI or interactive terminal.
`yolo` maps to each CLI's full bypass flag, such as Codex
`--dangerously-bypass-approvals-and-sandbox`, Claude
`--dangerously-skip-permissions`, or Gemini `--yolo`.
Use `yolo` only when you understand the security risk.

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
