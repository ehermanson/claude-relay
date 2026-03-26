# AGENTS.md — Relay

## Rules

- **Self-maintenance**: After any codebase change, check whether AGENTS.md and/or README.md need updating. Stale docs are worse than no docs.
- **Plan mode**: Make the plan extremely concise. Sacrifice grammar for the sake of concision. At the end of each plan, give a list of unresolved questions to answer, if any.
- **Workflow**: For anything beyond a trivial fix, create tasks in `.relay/tasks.jsonl` before starting work. Append a JSON line with `{id, title, status: "open", ...}` to create, append a line with the same `id` and changed fields to update. Set `status: "in_progress"` when starting, `status: "done"` when complete.

## Project Overview

Relay is a bridge between remote devices and local AI coding agents. It manages multiple agent processes, discovers external sessions, and serves a React web UI.

**Two-layer package:**

- `relay` (core) — process management, instance orchestration, types. No server deps.
- `relay/server` — HTTP, WebSocket, auth, tunnel, UI. Extends core.

## Architecture Philosophy

In the backend, Relay manages providers through a provider-driver registry (`provider-registry.ts`): each provider declares its capabilities and owns session creation, model lookup, transcript parsing, external-session discovery, and managed-session recovery behind the shared `ProviderSession`/`ProviderRuntimeBinding` contract. The UI asks the server for available providers (`GET /api/providers`) and provider-scoped model metadata plus capabilities (`GET /api/provider-models`), then shows or hides toolbar controls and picker options from that metadata.

**Key architectural invariants:**

- `ProviderCapabilities` is the single source of truth for what controls the UI should render — never hardcode provider-specific logic in the UI
- SQLite has two distinct roles: `sessions` is a rebuildable Claude transcript index, while `managed_sessions` is the source of truth for managed-session provider bindings and restore metadata
- JSONL files on disk are the canonical transcript source — the DB is a cache/index that can be rebuilt by scanning `~/.claude/projects/`
- Core must never import from server; server imports from core; UI imports from core via `@shared` alias
- Session targeting after first response always uses `--resume <sessionId>`, never `--continue` (which picks the most-recently-modified session in CWD — wrong with concurrent sessions)

## Tech Stack

- **Runtime**: Node.js 20+, ESM only (`"type": "module"`)
- **Language**: TypeScript (strict mode)
- **Server**: `node:http` host server + Hono for HTTP routing + `ws` for WebSockets
- **UI**: React 19 + Vite + Tailwind CSS v4 + React Router
- **Tests**: Node.js built-in test runner (`node --test`)

## Build & Test

```bash
pnpm build          # tsc + vite build
pnpm build:server   # tsc only
pnpm build:ui       # UI typecheck + vite build
pnpm typecheck      # server + UI TypeScript checks
pnpm test           # node --test test/*.test.js
pnpm dev            # concurrent: node --watch, tsc --watch, vite dev
```

Always `pnpm build:server` before `pnpm test` — tests import from `dist/`.

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

- InstanceManager polls provider-specific external discovery every 10s; drivers currently use `ps` + `lsof` and exclude managed PIDs
- `scanAllSessions()` walks provider transcript roots (`~/.claude/projects/`, `~/.codex/sessions/`) on startup for historical sessions
- `decodeProjectDir()` uses greedy filesystem-validated decode (not naive `-` → `/`) to handle dashed project names
- JSONL watchers track incremental changes with dedup: suppressed while process is active, offset advanced to EOF when process finishes

### Lazy Hydration

Sidebar/dashboard rows render from persisted SQLite metadata first. Opening a chat triggers lazy hydration: transcript replay, task/file/team state restore, git info refresh, watcher start, and provider session boot when resumable state exists.

### Spaces

Spaces group multiple concurrent agent chats within a shared git worktree/branch (`Project → Space[] → Chat[]`). Every project has an implicit "main" space (no worktree, default branch). Additional spaces create dedicated worktrees in `~/.relay/worktrees/space-<id>/`.

- `SpaceManager` (`src/core/space-manager.ts`) owns space lifecycle: create, list, complete (merge + cleanup), delete (archive + cleanup)
- `spaces` table in SQLite with `space_id` FK on `sessions` and `managed_sessions`
- Space completion auto-commits dirty worktrees, merges into the default branch, and removes the worktree
- REST API: `GET/POST /api/projects/:dir/spaces`, `GET/DELETE /api/spaces/:id`, `POST /api/spaces/:id/complete`, `GET /api/spaces/:id/diff`
- WS messages: `create_space`, `complete_space`, `delete_space` (client); `space_created`, `space_completed`, `space_removed`, `space_list` (server)
- Non-default spaces render as clickable items in the sidebar; selecting one opens a tab-based view with horizontal tabs per chat
- Non-git projects fall back to flat Chat[] model (spaces require git)
- `pushSpace()` pushes the space branch and optionally creates a PR via `gh pr create` — all git args use `execFileSync` array form to prevent shell injection

### Git Integration

- `GitStatusBar` component renders below the project header: branch selector, push/pull/fetch buttons, ahead/behind indicators, dirty-state badge
- `src/core/git.ts` provides pure-function git helpers: `listBranches()`, `getAheadBehind()`, `checkoutBranch()`, `gitFetch()`, `gitPull()`, `gitPush()`, `getPrimaryRemote()`
- `getPrimaryRemote(dir)` detects the actual remote name (prefers `origin`, falls back to first listed) — never hardcode `"origin"`
- Remote branch names are stripped of the dynamic remote prefix (not hardcoded `origin/`)
- REST API: `GET /api/projects/:id/branches`, `POST /api/projects/:id/checkout`, `POST /api/projects/:id/git/fetch`, `POST /api/projects/:id/git/pull`, `POST /api/projects/:id/git/push`
- Space push: `POST /api/spaces/:id/push` with optional `{ createPR: true }`

### Project Settings

- Per-project settings stored in `projects` table: `custom_instructions`, `default_space_branch`, `default_provider`, `default_model`
- Custom instructions are injected as an internal user message on the first turn of managed sessions
- Default provider/model are used when creating new sessions within the project
- Default space branch determines the base branch when creating new spaces (worktrees)
- Settings page: `/projects/:id/settings` with textarea for instructions, branch picker, provider/model selectors
- `normalizeProjectRow()` in `db.ts` null-coalesces all optional fields before SQLite upsert — guards against older rows or migration sources missing new columns

### Plan Review Abstraction

- Provider-specific plan output should normalize onto Relay's shared `ExitPlanMode` / `pendingPlan` / `planContent` flow instead of inventing a separate UI path
- Codex `<proposed_plan>...</proposed_plan>` blocks are treated as plan-review events, not plain assistant markdown, in both live app-server streaming and transcript replay

### Model Options

`ProviderModelOptions` (`reasoningBudgetTokens`, `reasoningEffort`, `fastMode`) is the canonical contract for provider-agnostic model tuning. Provider drivers map these to provider-specific session args.

- `InstanceInfo.modelOptions` is canonical; `InstanceInfo.reasoningBudget` is a derived compat field
- `model_options_json` column on `managed_sessions` (v15) is canonical storage; `reasoning_budget` column is a compat write
- Restore order: `model_options_json` first, fall back to legacy `reasoning_budget`
- `set_model_options` WS message does sparse merge (omitted = untouched, `null` = clear); `set_reasoning_budget` is a compat shim that delegates
- `ProviderCapabilities` includes control metadata (`reasoningBudgetLevels`, `reasoningEffortLevels`, `permissionModes`, `planModes`, `fastModes`) — UI renders labels/descriptions from these, never hardcodes provider-specific text
- `ReasoningEffort` uses `"max"` as the Relay-canonical highest effort; provider drivers map to native values (e.g. Codex `"xhigh"`); unknown strings pass through

### Task Tracking

- Tasks stored in `.relay/tasks.jsonl` (append-only JSONL, one JSON object per line)
- Not every request needs a task. Create a task only when the user asks to create one, pick up a task only when the user asks or the request clearly matches an existing task, and otherwise just do the work without creating a new task. Ask the user if it's unclear whether a request should map to a task.
- Fields: `id` (8-char hex), `title`, `description` (markdown), `status` (open|in_progress|done), `priority` (0-4), `type` (epic|task|bug), `tags` (string[]), `parent` (nullable task ID), `blockedBy` (task ID[]), `createdAt`, `updatedAt` (ISO timestamps)
- `blocked` status auto-derived from unresolved `blockedBy` refs — never set manually
- Create: append new JSON line. Update: append line with same `id` + changed fields (sparse merge). Delete: append `{id, deleted: true}`
- Relay compacts (dedupes, strips tombstones) on every write through the API
- Core module: `src/core/task-manager.ts` (pure functions, no server deps)
- API: `GET|POST /api/projects/:id/tasks`, `PATCH|DELETE /api/projects/:id/tasks/:taskId`
- On managed session start, Relay injects an internal message telling the model about the task format

## Common Pitfalls

- **`.js` extensions**: All relative imports in TypeScript must use `.js` extensions (ESM + NodeNext resolution).
- **Build before test**: Tests import from `dist/`, not `src/`. A stale build = confusing test failures.
- **`import.meta.dirname`**: Used in `server/http.ts` for locating static assets. Path is relative to compiled `.js` file location (`dist/server/http.js`), not source `.ts`. If this file moves, update the paths.
