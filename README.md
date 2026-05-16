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
