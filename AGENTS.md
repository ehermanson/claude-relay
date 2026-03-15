# AGENTS.md — Relay

## Rules

- **Self-maintenance**: After any codebase change, check whether AGENTS.md and/or README.md need updating. Stale docs are worse than no docs.
- **Plan mode**: Make the plan extremely concise. Sacrifice grammar for the sake of concision. At the end of each plan, give a list of unresolved questions to answer, if any.
- **Workflow**: For anything beyond a trivial fix, create Beads (`bd`) issues before starting work. Break the task into discrete issues, claim with `bd update <id> --claim`, close with `bd close <id>`. Use `bd list`, `bd show <id>`, `bd status` to review state.

## Project Overview

Relay is a bridge between remote devices and local AI coding agents. It manages multiple agent processes, discovers external sessions, and serves a React web UI.

**Two-layer package:**

- `relay` (core) — process management, instance orchestration, types. No server deps.
- `relay/server` — HTTP, WebSocket, auth, tunnel, UI. Extends core.

## Architecture Philosophy

In the backend, Relay manages providers through a provider-driver registry (`provider-registry.ts`): each provider declares its capabilities and owns session creation, model lookup, transcript parsing, and managed-session recovery behind the shared `ProviderSession`/`ProviderRuntimeBinding` contract. The UI asks the server for available providers (`GET /api/providers`) and provider-scoped model metadata plus capabilities (`GET /api/provider-models`), then shows or hides toolbar controls and picker options from that metadata.

**Key architectural invariants:**

- `ProviderCapabilities` is the single source of truth for what controls the UI should render — never hardcode provider-specific logic in the UI
- SQLite has two distinct roles: `sessions` is a rebuildable Claude transcript index, while `managed_sessions` is the source of truth for managed-session provider bindings and restore metadata
- JSONL files on disk are the canonical transcript source — the DB is a cache/index that can be rebuilt by scanning `~/.claude/projects/`
- Core must never import from server; server imports from core; UI imports from core via `@shared` alias
- Session targeting after first response always uses `--resume <sessionId>`, never `--continue` (which picks the most-recently-modified session in CWD — wrong with concurrent sessions)

## Tech Stack

- **Runtime**: Node.js 20+, ESM only (`"type": "module"`)
- **Language**: TypeScript (strict mode)
- **Server**: Raw `node:http` + `ws`. No Express/Fastify/etc.
- **UI**: React 19 + Vite + Tailwind CSS v4 + React Router
- **Tests**: Node.js built-in test runner (`node --test`)

## Build & Test

```bash
npm run build          # tsc + vite build
npm run build:server   # tsc only
npm run build:ui       # vite build only
npm test               # node --test test/*.test.js
npm run dev            # concurrent: node --watch, tsc --watch, vite dev
```

Always `npm run build:server` before `npm test` — tests import from `dist/`.

## Key Conventions

### Package Exports

```json
{ ".": "./dist/core/index.js", "./server": "./dist/server/index.js" }
```

`server/index.ts` re-exports all of core — importing from `relay/server` gives you everything. UI imports shared types via `@shared/types` (Vite alias → `src/core/types.ts`).

### Config Hierarchy

- `CoreConfig` — minimal config for core modules
- `RelayConfig extends CoreConfig` — adds server-specific options (port, auth, rate limiting, etc.)
- Structural subtyping makes `RelayConfig` assignable to `CoreConfig`

### External Session Discovery

- InstanceManager polls `ps` + `lsof` every 10s to find running `claude` processes; managed PIDs excluded
- `scanAllSessions()` walks `~/.claude/projects/` on startup for historical sessions
- `decodeProjectDir()` uses greedy filesystem-validated decode (not naive `-` → `/`) to handle dashed project names
- JSONL watchers track incremental changes with dedup: suppressed while process is active, offset advanced to EOF when process finishes

### Lazy Hydration

Sidebar/dashboard rows render from persisted SQLite metadata first. Opening a chat triggers lazy hydration: transcript replay, task/file/team state restore, git info refresh, watcher start, and provider session boot when resumable state exists.

## Common Pitfalls

- **`.js` extensions**: All relative imports in TypeScript must use `.js` extensions (ESM + NodeNext resolution).
- **Build before test**: Tests import from `dist/`, not `src/`. A stale build = confusing test failures.
- **`import.meta.dirname`**: Used in `server/http.ts` for locating static assets. Path is relative to compiled `.js` file location (`dist/server/http.js`), not source `.ts`. If this file moves, update the paths.
