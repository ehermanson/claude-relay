# AGENTS.md — Relay

## Rules

- **Self-maintenance**: After any codebase change, check whether AGENTS.md and/or README.md need updating. Stale docs are worse than no docs.
- **Plan mode**: Make the plan extremely concise. Sacrifice grammar for the sake of concision. At the end of each plan, give a list of unresolved questions to answer, if any.
- **Workflow**: For anything beyond a trivial fix, create tasks in `.relay/tasks.json` before starting work. Relay manages this snapshot file atomically; update the canonical task object and persist the full snapshot. Set `status: "in_progress"` when starting, `status: "done"` when complete.

## Ubiquitous Language

Use `UBIQUITOUS_LANGUAGE.md` as the canonical glossary for domain terminology in user-facing language, docs, UI copy, issue discussion, and agent responses.

High-risk distinctions:

- **Project** = top-level codebase
- **Space** = branch-scoped collaboration area within a project
- **Chat** = user-facing conversation
- **Managed session** / **External session** = runtime behind a chat
- **Complete** = merge and close a space
- **Archive** = close a space without merging

## Project Overview

Relay is a bridge between remote devices and local AI coding agents. It manages multiple agent processes, discovers external sessions, and serves a React web UI.

**Three-layer structure:**

- `app/` — React UI (the product)
- `server/` — HTTP, WebSocket, auth, tunnel + `server/core/` (engine: managers, types, providers)
- `cli/` — CLI wiring (bin.ts, migration.ts)

## Architecture Philosophy

In the backend, Relay manages providers through a provider-driver registry (`server/core/provider-registry.ts`): each provider declares its capabilities and owns session creation, model lookup, transcript parsing, external-session discovery, and managed-session recovery behind the shared `ProviderSession`/`ProviderRuntimeBinding` contract. The UI asks the server for available providers (`GET /api/providers`) and provider-scoped model metadata plus capabilities (`GET /api/provider-models`), then shows or hides toolbar controls and picker options from that metadata.

**Key architectural invariants:**

- Relay is multi-provider. Never assume a behavior is Claude-only or Codex-only without checking the provider contract and the sibling driver(s). For provider-facing changes, either update every affected provider path or document why the behavior is genuinely provider-specific.
- `ProviderCapabilities` is the single source of truth for what controls the UI should render — never hardcode provider-specific logic in the UI
- SQLite has two distinct roles: `sessions` is a rebuildable Claude transcript index, while `managed_sessions` is the source of truth for managed-session provider bindings and restore metadata
- JSONL files on disk are the canonical transcript source — the DB is a cache/index that can be rebuilt by scanning `~/.claude/projects/`
- Core (`server/core/`) must never import from server; server imports from core; UI imports from core via `@shared` alias
- Session targeting after first response always uses `--resume <sessionId>`, never `--continue` (which picks the most-recently-modified session in CWD — wrong with concurrent sessions)

## Tech Stack

- **Runtime**: Node.js 22+, ESM only (`"type": "module"`), native TS execution in dev
- **Language**: TypeScript (strict mode)
- **Server**: `node:http` host server + Hono for HTTP routing + `ws` for WebSockets
- **UI**: React 19 + Vite + Tailwind CSS v4 + React Router
- **Tests**: Node.js built-in test runner (`node --test`)

## Build & Test

```bash
pnpm build          # tsc + vite build
pnpm build:server   # tsc only
pnpm build:app      # UI typecheck + vite build
pnpm typecheck      # server + UI TypeScript checks
pnpm test           # node --test test/*.test.js
pnpm dev            # server from TS source (no tsc) + vite dev
```

Always `pnpm build:server` before `pnpm test` — tests import from `dist/`.

### Dev Mode

`pnpm dev` runs the server directly from TypeScript source via Node's native type stripping (`--conditions=relay-dev` remaps `#` imports to `.ts` files). No `tsc --watch`, no `dist/` dependency, no auto-restart. Press `r` to manually restart the server.

This avoids the "using the tool to work on the tool" problem — AI agents modifying server files won't trigger disruptive mid-operation restarts.

Dev state is isolated: `pnpm dev` defaults `RELAY_HOME` to `~/.relay-develop` (override by setting `RELAY_HOME`), so a dev server never shares `sessions.db`, `provider-state.json`, or worktrees with a production install using `~/.relay`. Two servers writing the same home causes last-writer-wins state clobbering and schema-version DB rebuild ping-pong.

## Key Conventions

### Import Aliases

Server + CLI use Node.js native subpath imports (`#` prefix):

- `#core/foo.js` → `server/core/foo.ts` (compile) / `dist/server/core/foo.js` (runtime)
- `#server/foo.js` → `server/foo.ts` (compile) / `dist/server/foo.js` (runtime)

App uses Vite resolve.alias:

- `@/*` → `app/src/*`
- `@shared/*` → `server/core/*`

Zero relative path navigation (`../`) in any server/cli import.

### Package Exports

```json
{ ".": "./dist/server/core/index.js", "./server": "./dist/server/index.js" }
```

`server/index.ts` re-exports all of core — importing from `relay/server` gives you everything. UI imports shared types via `@shared/types` (Vite alias → `server/core/types.ts`).

### Config Hierarchy

- `CoreConfig` — minimal config for core modules
- `RelayConfig extends CoreConfig` — adds server-specific options (port, auth, rate limiting, etc.)
- Structural subtyping makes `RelayConfig` assignable to `CoreConfig`

### External Session Discovery

- InstanceManager polls provider-specific external discovery every 30s; drivers currently use `ps` + `lsof` and exclude managed PIDs
- `scanAllSessions()` walks provider transcript roots (`~/.claude/projects/`, `~/.codex/sessions/`) on startup for historical sessions
- `decodeProjectDir()` uses greedy filesystem-validated decode (not naive `-` → `/`) to handle dashed project names
- JSONL watchers track incremental changes with dedup: suppressed while process is active, offset advanced to EOF when process finishes

### iOS Keyboard Handling

The iOS keyboard is handled by **accepting** WebKit's native page push (the header slides off-screen while typing — standard iOS webapp behavior) and making scroll math visual-viewport-aware instead of mutating layout. The message-framing effect in `message-list.tsx` intersects the scroll container with `window.visualViewport` to compute the pin position (`messageTop − hiddenTop`), spacer size, and handoff threshold. Dead ends — tried and reverted (see git history), don't relearn them:

- iOS standalone PWAs do **not** resize the layout viewport for the keyboard (and ignore `interactive-widget=resizes-content`); they shrink the visual viewport and push the page via `visualViewport.offsetTop` + window scroll
- Reactive countermeasures jitter: `scrollTo(0,0)` fights an animated push (and `html { scroll-behavior: smooth }` animates the correction); transform-following the offset moves the focused input and re-triggers WebKit's reveal (feedback loop)
- Pre-shrinking `<body>` on `focusin` prevents the push, but iOS freezes web-content compositing during the keyboard presentation, so the shrink paints only after the transition settles (~1s perceived stall) — web-unfixable
- Pre-shrinking at `pointerdown` paints in time but moves the tap target mid-gesture — iOS abandons the tap (no focus, no keyboard)

### Lazy Hydration

Sidebar/dashboard rows render from persisted SQLite metadata first. Opening a chat triggers lazy hydration of transcript/task/file state and git info, but history reads stay passive: Relay does not boot/resume a stopped managed session until the user explicitly sends a message (or otherwise takes over/resumes it).

### Entry Screens & Project View

Phone users open Relay to start or continue a chat, so the entry screens lead with chats, not stats.

- **Project view IA is identical on mobile and desktop**: tabs are `Overview · Plans · [Tasks] · [Skills] · [Spaces] · Settings` — there is **no Chats tab**. **Overview _is_ the chat list** (`ProjectChatList` in `app/src/pages/chats-page.tsx`) with an expandable "Project stats" strip above it (token cards + model breakdown + docs, collapsed by default). The Overview tab carries the chat count + active badge.
- The chat list is **one flat list** of standalone + space chats; space chats are tagged with their branch via the shared `ChatListRow` (`app/src/components/chat/chat-list-row.tsx`). Only row density adapts: dense `ChatListRow`s on mobile, rich `SessionCard`s on desktop.
- The legacy `/projects/:id/chats` list route now **redirects to Overview** (`/projects/:id`); link there for "all chats", not to a separate page. The `chats/$chatId` individual chat view is unchanged.
- **Home/dashboard cards intentionally diverge by viewport** (the one justified split, driven by the desktop sidebar already listing chats): desktop cards show stats + model chips; mobile cards show the project's recent chats (top 5, via `ChatListRow`). Gate with `useMediaQuery("(max-width: 768px)")`.
- **Dashboard uses the same data model as the sidebar** (`useProjectNavigationModel`): REST chat summaries merged with live WS instances in the shared user-defined project order — never render entry-screen chat lists from WS state alone (it's empty until `instance_list` arrives).
- **The react-query cache is persisted to localStorage** (`relay:query-cache`, wired in `app/src/routes/__root.tsx`) for an allowlist of read-mostly entry-screen queries (`projects`, `projectChats`, `projectArtifacts`, `projectIcons`, `global-settings`, `spaces`), so revisits paint from last-known data and refetch in the background. Bump the `buster` string there when a persisted query's data shape changes incompatibly.

### Spaces

Spaces group multiple concurrent agent chats within a shared git worktree/branch (`Project → Space[] → Chat[]`). Every project has an implicit "main" space (no worktree, default branch). Additional spaces create dedicated worktrees in `<RELAY_HOME>/worktrees/space-<id>/` (defaults to `~/.relay/worktrees/space-<id>/`).

- `SpaceManager` (`server/core/space-manager.ts`) owns space lifecycle: create, list, complete (merge + cleanup), delete (archive + cleanup)
- Each space has a "brief" at `.relay/space-context.md` (git-excluded, seeded on creation). Its **contents** are injected into every chat's bootstrap context (the space-level analog of project custom instructions) via `buildSpaceBootstrapContextBlock` + `extractSpaceContextForInjection` — only when the file has authored content beyond the seed template, and only at session start (new/resumed chats).
- `spaces` table in SQLite with `space_id` FK on `sessions` and `managed_sessions`
- Space completion auto-commits dirty worktrees, merges into the default branch, and removes the worktree; local branch is kept for recoverability
- `MergeMethod` type: `"squash" | "merge-commit"` — passed per-merge via `completeSpace(id, { mergeMethod, squashMessage? })`; default is `"squash"`
- `spaces` table stores merge metadata (`merge_commit`, `merge_method`, `merged_at`, `target_branch`) and remote tracking (`remote_status`, `pr_url`)
- Lifecycle states: `active` → `completed` (merged) or `archived` (closed without merge); completed/archived spaces are read-only in the UI
- UI terminology: "Complete" (action label), "Merged"/"Archived" (status badges), "Archive" (replaces "Delete" in UI)
- Sidebar shows Active spaces → Chats → Closed spaces (collapsed); mini-sidebar shows active only
- REST API: `GET/POST /api/projects/:dir/spaces`, `GET /api/projects/:dir/spaces/all`, `GET/DELETE /api/spaces/:id`, `POST /api/spaces/:id/complete`, `GET /api/spaces/:id/diff`
- WS messages: `create_space`, `complete_space`, `delete_space` (client); `space_created`, `space_completed`, `space_removed`, `space_list` (server)
- `space_list` broadcast includes all spaces (active + closed) so the sidebar can render the closed section
- Non-default spaces render as clickable items in the sidebar; selecting one opens a tab-based view with horizontal tabs per chat
- Non-git projects fall back to flat Chat[] model (spaces require git)
- `pushSpace()` pushes the space branch and optionally creates a PR via `gh pr create` — all git args use `execFileSync` array form to prevent shell injection; persists `remote_status`/`pr_url` on the space

### Git Integration

- `GitStatusBar` component renders below the project header: branch selector, push/pull/fetch buttons, ahead/behind indicators, dirty-state badge
- `server/core/git.ts` provides pure-function git helpers: `listBranches()`, `getAheadBehind()`, `checkoutBranch()`, `gitFetch()`, `gitPull()`, `gitPush()`, `getPrimaryRemote()`
- `getPrimaryRemote(dir)` detects the actual remote name (prefers `origin`, falls back to first listed) — never hardcode `"origin"`
- Remote branch names are stripped of the dynamic remote prefix (not hardcoded `origin/`)
- REST API: `GET /api/projects/:id/branches`, `POST /api/projects/:id/checkout`, `POST /api/projects/:id/git/fetch`, `POST /api/projects/:id/git/pull`, `POST /api/projects/:id/git/push`
- Space push: `POST /api/spaces/:id/push` with optional `{ createPR: true }`

### Project Settings

- Per-project settings stored in `projects` table: `custom_instructions`, `default_space_branch`, `default_provider`, `default_model`
- Custom instructions and task guidance should be delivered as structured session bootstrap context when the provider supports it; avoid rewriting the first user message unless falling back for compatibility
- Default provider/model are used when creating new sessions within the project
- Default space branch determines the base branch when creating new spaces (worktrees)
- Settings page: `/projects/:id/settings` with textarea for instructions, branch picker, provider/model selectors
- `SessionDB` creates the final schema directly; any DB whose `schema_version` does not match the current version is backed up and rebuilt from transcript discovery
- Removing a project writes a tombstone to the `removed_projects` table; `recoverProjectsFromSessionDirectories()` skips tombstoned directories so removed projects don't resurrect from leftover session rows. Only explicit re-registration (`addProject`, including starting a chat in that directory) clears the tombstone

### Provider Version Advisories

- `ProviderCapabilities.versionAdvisory` carries the result of the provider-version probe: installed CLI version vs latest npm-published version, detected install method, and the recommended update command
- Probe runs in `server/core/provider-versions.ts` (pure helpers + `buildVersionAdvisory`); `server/core/provider-registry.ts` caches the result in-memory and refreshes every 30 min
- Latest-version lookup hits the npm registry with a 1h in-memory cache; `POST /api/providers/recheck-version` force-bypasses the cache (used by the settings "Re-check" button)
- `POST /api/providers/update?provider=<kind>` runs the advisory's update command server-side (`runProviderUpdate` in `provider-registry.ts`): the command is always server-derived from `buildUpdateCommand` (never client-supplied), executed shell-less via `execFile` with a 10-min timeout; concurrent requests per provider share one run, and the advisory is force re-probed afterward. Automatic update is offered only for detected non-manual install methods; manual installs keep a copyable recommendation but are not run server-side.. Automatic update is offered only for detected non-manual install methods; manual installs keep a copyable recommendation but are not run server-side.
- UI surfaces a one-shot sonner toast at app launch via `app/src/components/provider-update-notification.tsx`; dismissals persist per (provider, latestVersion) key in localStorage (`use-dismissed-provider-advisories.ts`)
- The settings page renders a per-provider advisory card inside `ProviderDefaultsRow` with a copy-to-clipboard update command, an "Update now" button (inline confirm step → runs the update via the server), and a manual recheck button

### Claude Plan Rate Limits

- Plan utilization has two SDK sources: live `rate_limit_event` messages mid-session, and the experimental `get_usage` snapshot (SDK ≥ 0.3.169) probed at prewarm, session start, and after each completed turn (throttled, `refreshUsageRateLimits` in `server/core/providers/claude-sdk.ts`). Always feature-detect the snapshot method (`usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET`) — it will be renamed at stabilization.
- Merging is field-level, never whole-window: live events carry `status` (and only sometimes `utilization` — `allowed` events have none), the snapshot carries authoritative `utilization` but no status. An event without utilization must not erase a known percentage, and a snapshot below 100% clears a stale `rejected` (both in `claude-sdk.ts` and in `mergeRateLimitWindows` in `instance-manager.ts`). The CLI replays cached rate-limit status at session start, so a latched `rejected` that snapshots can't override will stick for hours.

### Plan Review Abstraction

- Provider-specific plan output should normalize onto Relay's shared `ExitPlanMode` / `pendingPlan` / `planContent` flow instead of inventing a separate UI path
- Codex `<proposed_plan>...</proposed_plan>` blocks are treated as plan-review events, not plain assistant markdown, in both live app-server streaming and transcript replay

### Model Options

`ProviderModelOptions` (`reasoningEffort`, `fastMode`) is the canonical contract for provider-agnostic model tuning. Provider drivers map these to provider-specific session args.

- `InstanceInfo.modelOptions` is canonical
- `model_options_json` column on `managed_sessions` is the canonical storage for provider-agnostic model tuning
- `set_model_options` WS message does sparse merge (omitted = untouched, `null` = clear)
- `ProviderCapabilities` includes control metadata (`reasoningEffortLevels`, `runtimeModes`, `fastModes`) — UI renders labels/descriptions from these, never hardcodes provider-specific text
- `ReasoningEffort` uses `"max"` as the Relay-canonical highest effort; provider drivers map to native values (e.g. Codex `"xhigh"`); unknown strings pass through

### Task Tracking

- Tasks stored in `.relay/tasks.json` (Relay-managed snapshot JSON)
- Not every request needs a task. Create a task only when the user asks to create one, pick up a task only when the user asks or the request clearly matches an existing task, and otherwise just do the work without creating a new task. Ask the user if it's unclear whether a request should map to a task.
- Fields: `id` (8-char hex), `title`, `description` (markdown), `status` (open|in_progress|done), `priority` (0-4), `type` (epic|task|bug), `tags` (string[]), `parent` (nullable task ID), `blockedBy` (task ID[]), `createdAt`, `updatedAt` (ISO timestamps)
- `blocked` status auto-derived from unresolved `blockedBy` refs — never set manually
- Create/update/delete: rewrite `.relay/tasks.json` atomically with the new canonical snapshot
- Relay rewrites the canonical snapshot atomically on every write through the API
- Core module: `server/core/task-manager.ts` (pure functions, no server deps)
- API: `GET|POST /api/projects/:id/tasks`, `PATCH|DELETE /api/projects/:id/tasks/:taskId`
- On managed session start, Relay injects an internal message telling the model about the task format

## Common Pitfalls

- **`#` imports**: All imports in `server/` and `cli/` use `#core/` or `#server/` aliases. No relative path navigation (`../`).
- **`.js` extensions**: All `#` imports must use `.js` extensions (ESM + NodeNext resolution).
- **Build before test**: Tests import from `dist/`, not source. A stale build = confusing test failures.
- **`import.meta.dirname`**: `server/http.ts` detects whether it's running from source or `dist/` to compute the project root. Avoid hardcoded `../..` traversals — use the `projectRoot` constant instead.
- **No parameter properties**: Node's native TS type stripping doesn't support `constructor(private x: T)` syntax. Use explicit field declarations + assignment instead. (This is what enables `pnpm dev` to run without tsc.)
