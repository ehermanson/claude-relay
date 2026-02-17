# CLAUDE.md — Claude Relay

## Self-Maintenance Rule

**After any change to the codebase**, check whether CLAUDE.md and/or README.md need updating. This includes:
- New files, renamed files, or deleted files → update file maps below
- New features or changed behavior → update README
- New environment variables or config options → update both
- Changed build steps or test commands → update both
- Architectural changes → update both

This is not optional. Stale docs are worse than no docs.

## Project Overview

Claude Relay is a bridge between remote devices and a local Claude Code CLI. It manages multiple Claude Code processes, discovers external sessions, and serves a React web UI.

**Two-layer package:**
- `claude-relay` (core) — process management, instance orchestration, types. No server deps.
- `claude-relay/server` — HTTP, WebSocket, auth, tunnel, UI. Extends core.

## Tech Stack

- **Runtime**: Node.js 20+, ESM only (`"type": "module"`)
- **Language**: TypeScript (strict mode)
- **Server**: Raw `node:http` + `ws` library. No Express/Fastify/etc.
- **UI**: React 18 + Vite + Tailwind CSS v4 + React Router
- **Tests**: Node.js built-in test runner (`node --test`)
- **Dependencies**: Only `cookie` and `ws`. That's it.

## Build & Test

```bash
npm run build          # tsc + vite build
npm run build:server   # tsc only
npm run build:ui       # vite build only
npm test               # node --test test/*.test.js
npm run dev            # concurrent: node --watch, tsc --watch, vite dev
```

Always `npm run build:server` before `npm test` — tests import from `dist/`.

## Project Structure

```
src/
  bin.ts                     CLI entry point, imports from ./server/
  core/
    types.ts                 All shared type definitions (messages, instances, sessions)
    config.ts                CoreConfig interface, CoreOptions, resolveCoreConfig()
    logger.ts                Logger interface, noopLogger
    tools.ts                 describeToolUse(), describeToolDetail()
    claude-process.ts        ClaudeProcess class — spawns `claude -p`, parses stream-json, setSessionId()
    instance-manager.ts      InstanceManager — multi-instance + external session discovery
    index.ts                 Barrel: exports all core API
  server/
    config.ts                RelayConfig extends CoreConfig, RelayOptions, resolveConfig()
    auth.ts                  AuthManager — password auth, sessions, cookies, rate limiting
    http.ts                  createRequestHandler() — REST API + static files + SPA fallback
    websocket.ts             createWebSocketServer() — subscription-based real-time relay
    tunnel.ts                startTunnel(), stopTunnel() — cloudflared lifecycle
    index.ts                 ClaudeRelay class, createRelay(), re-exports core + server
test/
  *.test.js                  Tests import from dist/core/ and dist/server/
ui/
  src/
    context/                 AuthContext, WebSocketContext, ThemeContext
    hooks/                   useAuth, useWebSocket, useInstanceMessages, useAutoScroll, useDirectoryBrowser, useMediaQuery
    pages/                   LoginPage, ChatPage
    components/chat/         InstanceView, MessageList, ClaudeMessage, UserMessage, InputArea, ActivityGroup, etc.
    components/layout/       Sidebar, SidebarItem
    components/forms/        NewInstanceForm, DirectoryPicker
    lib/                     api.ts, markdown.ts, utils.ts
  vite.config.ts             @shared alias → ../src/core
  tsconfig.json              paths: @shared/* → ../src/core/*
```

## Key Conventions

### Config Hierarchy
- `CoreConfig` — minimal: workingDirectory, dangerouslySkipPermissions, processTimeout, maxInstances, logger, manifestFile
- `RelayConfig extends CoreConfig` — adds: port, password, sessionMaxAge, serveUI, rateLimitMax, rateLimitWindow, sessionFile
- Core modules accept `CoreConfig`. Server modules accept `RelayConfig`. Structural subtyping makes RelayConfig assignable to CoreConfig.

### Package Exports
```json
{ ".": "./dist/core/index.js", "./server": "./dist/server/index.js" }
```
- `server/index.ts` does `export * from "../core/index.js"` — so importing from `claude-relay/server` gives you everything.
- UI imports shared types via `@shared/types` (Vite alias resolves to `src/core/types.ts`).

### import.meta.dirname
`server/http.ts` uses `import.meta.dirname` to locate `ui/dist/` and `package.json`. The compiled output lives at `dist/server/http.js`, so the path to project root is `../..`. If this file ever moves, update those paths.

### WebSocket Protocol
- Clients authenticate via session cookie on WS upgrade
- Subscription model: clients send `subscribe`/`unsubscribe` with instanceId
- Instance output/activity/exit go only to subscribers
- Status/create/remove events broadcast to all clients

### Permission Approval Flow
- When `dangerouslySkipPermissions` is false (default), Claude CLI denies tool use with an `is_error` tool_result
- `parsePermissionDenial()` in `tools.ts` extracts the tool name from denial messages
- `ClaudeProcess.allowedTools` accumulates approved tools; passed as `--allowedTools` on each `send()`
- `InstanceManager.approveToolUse(id, tool)` adds the tool and sends a retry prompt
- UI shows "Allow {tool}" button via `permissionDenied` field on `ActivityMessage`
- `allowedTools` is ephemeral — resets on relay restart
- WS message: `{ type: "approve_tool", instanceId, tool }`

### External Session Discovery
- InstanceManager polls `ps` + `lsof` every 10s to find running `claude` processes
- Matches PIDs to JSONL transcript files in `~/.claude/projects/`
- Watches JSONL files for incremental updates (2s poll)
- External sessions can be "resumed" — converts to a managed ClaudeProcess with `--resume`

### JSONL Watching (`watchState`)
- `watchState` (`jsonlPath` + `fileOffset`) lives on `Instance` independently of `externalState`
- All instance types get a JSONL watcher: external (on discovery), managed (after `captureSessionId`), restored (on startup)
- After resume, the watcher keeps running — picks up terminal-side changes when someone does `claude --resume` externally
- **Dedup strategy** (two layers):
  1. While `instance.process.isProcessing` is true, the watcher advances the file offset but suppresses event emission
  2. When the process finishes (`isWaiting`), `wireProcessEvents` advances the offset to EOF so the watcher has nothing to re-read
- The UI is always the unified view — it sees output from both the relay's process and external terminal activity
- Concurrent writes (UI + terminal at the same time) are unsupported — one active writer at a time

### Session Targeting
- First message of a new instance: `claude -p "message"` (no flags — creates a new session)
- `captureSessionId` fires after the first response, finds the JSONL, extracts the session ID, and calls `proc.setSessionId(id)`
- All subsequent messages use `--resume <sessionId>` for precise session targeting
- **Never relies on `--continue`** after session capture — `--continue` picks up the "most recently modified" session in the CWD, which can be wrong when multiple sessions share a directory

### Instance Persistence
- Managed instances are persisted to a JSON manifest file (`manifestFile` config)
- On startup, `restoreInstances()` reads the manifest and resumes sessions via `claude -p --resume <sessionId>`
- Session IDs are captured after the first message exchange by scanning `~/.claude/projects/<encoded-cwd>/` for the newest JSONL file
- `saveManifest()` is called after session ID capture and after instance removal
- `stopAll()` does NOT clear the manifest — instances survive relay restarts
- Stale entries (missing JSONL files) are silently skipped during restore
- `discoverExisting()` skips JSONL paths belonging to restored managed instances to prevent duplicates

### REST API
All routes except `/health` and `/auth` require authentication (session cookie).

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check (unauthenticated) |
| POST | `/auth` | Login with password |
| GET | `/logout` | Clear session |
| GET | `/api/instances` | List all instances |
| POST | `/api/instances` | Create new instance |
| DELETE | `/api/instances/:id` | Remove instance |
| GET | `/api/instances/:id/history` | Get conversation history |
| GET | `/api/stats` | Server stats |
| GET | `/api/directories` | Known Claude project directories |
| GET | `/api/browse?prefix=...` | Directory autocomplete |

### Testing
- Tests are plain `.js` files in `test/` that import from compiled `dist/`
- Core tests import from `dist/core/`, server tests from `dist/server/`
- The InstanceManager test uses `resolveConfig()` (server) to create config — works via structural subtyping
- Always build before testing

### Defaults
- `dangerouslySkipPermissions`: `false`
- `maxInstances`: `10`
- `serveUI`: `true`
- `port`: `7777`
- `processTimeout`: 5 minutes
- `sessionMaxAge`: 7 days
- `rateLimitMax`: 5 per minute
- `manifestFile`: `~/.claude-relay/instances.json`
- History capped at 1000 entries per instance

## Common Pitfalls

- **Circular imports**: Core must never import from server. Server imports from core. UI imports from core via `@shared` alias.
- **`.js` extensions**: All relative imports in TypeScript must use `.js` extensions (ESM + NodeNext resolution).
- **UI alias**: `@shared` points to `src/core/` (not `src/`). All UI type imports use `@shared/types`.
- **Build before test**: Tests import from `dist/`, not `src/`. A stale build = confusing test failures.
- **`import.meta.dirname`**: Only available in ESM. Used in `server/http.ts` for locating static assets. Path is relative to the compiled `.js` file location, not the source `.ts` file.
