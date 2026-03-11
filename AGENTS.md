# AGENTS.md — Codex Relay

## Self-Maintenance Rule

**After any change to the codebase**, check whether AGENTS.md and/or README.md need updating. This includes:

- New files, renamed files, or deleted files → update file maps below
- New features or changed behavior → update README
- New environment variables or config options → update both
- Changed build steps or test commands → update both
- Architectural changes → update both

This is not optional. Stale docs are worse than no docs.

## Workflow Rule

For anything beyond a trivial fix, **create Beads (bd) issues before starting work**:

1. Break the task into discrete issues (use epics to group related issues if needed)
2. Create issues via `bd create "Title"` (use `bd epic create` for epics, `bd dep add` for dependencies)
3. Then start implementation — claim issues with `bd update <id> --claim`
4. Keep issues updated as you go: `bd close <id>` when done, `bd comments add <id>` for notable decisions
5. Use `bd list`, `bd show <id>`, `bd status` to review state

Skip issue creation only for single-line fixes, typo corrections, or other clearly trivial changes.

## Project Overview

Codex Relay is a bridge between remote devices and a local Codex CLI. It manages multiple Codex processes, discovers external sessions, and serves a React web UI.

**Two-layer package:**

- `Codex-relay` (core) — process management, instance orchestration, types. No server deps.
- `Codex-relay/server` — HTTP, WebSocket, auth, tunnel, UI. Extends core.

## Tech Stack

- **Runtime**: Node.js 20+, ESM only (`"type": "module"`)
- **Language**: TypeScript (strict mode)
- **Server**: Raw `node:http` + `ws` library. No Express/Fastify/etc.
- **UI**: React 19 + Vite + Tailwind CSS v4 + React Router
- **Tests**: Node.js built-in test runner (`node --test`)
- **Dependencies**: `better-sqlite3`, `cookie`, `ws`, `react-resizable-panels` (UI), `@base-ui/react` (UI), `cmdk` (UI command palette), `lexical` + `@lexical/react` (UI composer), `simple-icons` (UI brand/framework file icons)

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
    tools.ts                 describeToolUse(), describeToolDetail(), estimateCost()
    git.ts                   isGitRepo(), getRepoRoot(), createWorktree(), removeWorktree()
    db.ts                    SessionDB class — SQLite-backed transcript index + managed-session runtime bindings
    claude-process.ts        ClaudeProcess class — spawns `Codex -p`, parses stream-json, setSessionId()
    provider.ts              ProviderSession contract for managed adapters
    provider-catalog.ts      Shared provider labels + built-in model catalogs
    session-handoff.ts       Provider-neutral prompt builder for spawning a new provider chat with carried context
    instance-manager.ts      InstanceManager — multi-instance + external session discovery
    workspace-entries.ts     Workspace indexing/search for composer `@` file mentions
    providers/
      claude-sdk.ts          Claude SDK provider session implementation
      codex-cli.ts           Managed Codex CLI provider session implementation (`codex exec --json`)
      codex-transcript.ts    Provider-specific Codex transcript lookup + replay from `~/.codex/sessions`
      codex-models.ts        Best-effort Codex app-server model discovery (`initialize` + `model/list`)
    index.ts                 Barrel: exports all core API
  server/
    config.ts                RelayConfig extends CoreConfig, RelayOptions, resolveConfig()
    auth.ts                  AuthManager — password auth, sessions, cookies, rate limiting
    http.ts                  createRequestHandler() — REST API + static files + SPA fallback
    project-opener.ts        Native app target discovery + per-project opener preferences
    websocket.ts             createWebSocketServer() — subscription-based real-time relay
    tunnel.ts                startTunnel(), stopTunnel() — cloudflared lifecycle
    index.ts                 ClaudeRelay class, createRelay(), re-exports core + server
test/
  *.test.js                  Tests import from dist/core/ and dist/server/
  fixtures/                  JSONL session fixtures for history-parsing tests
ui/
  src/
    context/                 auth-context, websocket-context, theme-context, project-context
    hooks/                   use-auth, use-web-socket, use-instance-messages, use-auto-scroll, use-directory-browser, use-media-query, use-terminal-pending-toasts
    pages/                   chat-page, login-page, project-page, plans-page, plan-page, issues-page
    components/chat/         instance-view, message-list, composer-editor, Codex-message, user-message, input-area, activity-group, sidecar, permission-banner, etc.
    components/chat/input-area/ shared input-area subcomponents + hooks: toolbar, provider picker, overlay menus, resume banner, attachments, composer panel, composer/attachment/provider state hooks, menu/resume hooks
    components/project/      shared project-level UI like the `OpenInMenu`
    components/ui/           command, file-icon, resizable-handle, badge, button, checkbox, collapsible, dialog, input, menu, popover, progress, spinner, switch, tabs, textarea, tooltip (backed by @base-ui/react + cmdk)
    components/layout/       app-layout, sidebar, sidebar-item
    components/forms/        new-instance-form, directory-picker
    lib/                     api.ts, composer-mentions.ts, file-icons.ts, markdown.ts, utils.ts
  vite.config.ts             @shared alias → ../src/core
  tsconfig.json              paths: @shared/* → ../src/core/*
```

## Key Conventions

### Config Hierarchy

- `CoreConfig` — minimal: workingDirectory, dangerouslySkipPermissions, processTimeout, maxProcesses, logger, dbPath, manifestFile (legacy, optional), `claudeDir` override, `codexDir` override
- `RelayConfig extends CoreConfig` — adds: port, password, sessionMaxAge, serveUI, rateLimitMax, rateLimitWindow, sessionFile
- Core modules accept `CoreConfig`. Server modules accept `RelayConfig`. Structural subtyping makes RelayConfig assignable to CoreConfig.

### Package Exports

```json
{ ".": "./dist/core/index.js", "./server": "./dist/server/index.js" }
```

- `server/index.ts` does `export * from "../core/index.js"` — so importing from `Codex-relay/server` gives you everything.
- `SessionDB` and `SessionRow` are exported from core (available via both `Codex-relay` and `Codex-relay/server`).
- UI imports shared types via `@shared/types` (Vite alias resolves to `src/core/types.ts`).

### Provider Adapters

- `provider.ts` defines the provider-agnostic managed-session contract consumed by `InstanceManager`
- `InstanceInfo.provider` is first-class and persisted for managed sessions
- Managed restore uses provider runtime bindings from SQLite, not the current default provider
- Claude JSONL remains a Claude-specific read model for history replay, transcript capture, and external-session discovery
- Codex transcript replay is handled separately via `providers/codex-transcript.ts`, which locates persisted sessions under `~/.codex/sessions` by provider session ID
- Current managed providers:
  - Claude via Agent SDK or Claude CLI fallback
  - Codex via `codex exec --json` / `codex exec resume --json`

### import.meta.dirname

`server/http.ts` uses `import.meta.dirname` to locate `ui/dist/` and `package.json`. The compiled output lives at `dist/server/http.js`, so the path to project root is `../..`. If this file ever moves, update those paths.

### Sidecar Panel (Tasks + Files + Team/Agents)

- **Tasks:** ClaudeProcess accumulates task state: `taskMap` + `pendingTaskCreates` intercept TaskCreate/TaskUpdate/TaskList/TaskGet tool events
- TaskCreate tool_use stores pending info; tool_result extracts ID via `Task #(\d+)` and creates TaskItem
- TaskUpdate tool_use updates taskMap (or deletes on `status: "deleted"`); emits consolidated `task_list` activity
- TaskList/TaskGet tools are suppressed (no activity emitted)
- Managed Codex sessions also emit `task_list` from `turn/plan/updated` app-server notifications, and Codex transcript replay rebuilds the same task state from `update_plan` / `plan_update` entries
- InstanceManager syncs `task_list` activities from process onto `instance.tasks`; JSONL parser handles `"deleted"` status
- **Files:** ClaudeProcess tracks `fileMap` — intercepts Edit/Write/NotebookEdit `tool_use` events, extracts `file_path`/`path`/`notebook_path`, emits consolidated `file_list` activity
- Managed Codex sessions also synthesize `file_list` activity from `apply_patch` custom-tool calls, and Codex transcript replay rebuilds the same file state from `custom_tool_call` / `custom_tool_call_output` entries
- InstanceManager syncs `file_list` activities from process onto `instance.files`; JSONL `convertJsonlEntry` also tracks file changes
- UI: `Sidecar` renders changed files and directories with `FileIcon` + `file-icons.ts`; generic file/folder glyphs use the app's neutral style while framework/language files use `simple-icons` brand marks (React, Svelte, Vue, Astro, HTML, CSS, etc.)
- **Team:** ClaudeProcess tracks `teamState` — intercepts TeamCreate, Task (with `team_name`), SendMessage (shutdown_request), TeamDelete tool events
- `TeamCreate` → initializes `TeamInfo` with name/description, emits consolidated `team_info` activity, suppressed from chat
- `Task` with `team_name` → adds `TeamMember` (status: "running"), emits `team_info`, suppressed from chat
- `SendMessage` with `type: "shutdown_request"` → updates member status to "shutting_down", emits `team_info`, NOT suppressed (still shows as activity)
- `TeamDelete` → marks all members "shutdown", emits `team_info`, suppressed from chat
- InstanceManager syncs `team_info` activities from process onto `instance.team`; `handleJsonlTeamTool` handles JSONL replay
- JSONL watcher also syncs `team_info` activities back to `instance.team`
- UI: `useInstanceMessages` exposes `currentTasks`, `currentFiles`, and `currentTeam` (separate from chat items); all persist across turns
- UI: `Sidecar` component renders as a `w-72` panel to the right of the chat, hidden on mobile
- Generalized N-tab support: available tabs built from content (Team/Agents > Tasks > Files priority order)
- 0 tabs → hidden, 1 tab → no tab bar (just header), 2-3 tabs → tab bar with counts
- Layout: `[Sidebar] [Chat | Sidecar]` — sidecar appears when tasks, files, team, or standalone agent activity exist; dismiss/un-dismiss based on combined content count
- **Agent Progress:** Codex emits `progress` JSONL events (v2.1.42+) with subtypes `agent_progress`, `bash_progress`, `hook_progress`
- `agent_progress`: Parsed by ClaudeProcess (`handleAgentProgress`) and `convertJsonlEntry`. Extracts tool descriptions and text output from `data.message.message.content` blocks. Stored in `agentActivityMap` (ClaudeProcess) / `instance.agentActivities` (InstanceManager). Emits `agent_activity` ActivityMessage with `AgentActivity[]`.
- `bash_progress`: Emits a `tool_use` activity with elapsed time description (e.g. "Running... 15s")
- `hook_progress`: Silently skipped — no user value
- Agent activities are high-frequency — skipped from history storage but synced to instance state and emitted to WS subscribers
- UI: `useInstanceMessages` exposes `currentAgentActivities`; the sidecar opens for live agent activity even without `team_info`. `TeamPanel` shows descriptions under matched team members and falls back to an "Agents" view for unmatched standalone agent activity

### Resizable Panels

- Sidebar and sidecar are resizable via `react-resizable-panels` (v4 API: `Group`, `Panel`, `Separator`)
- `ResizableHandle` (`ui/src/components/ui/ResizableHandle.tsx`) wraps the library's `Separator` with themed styling
- **AppLayout**: `Group` wraps sidebar panel (25% default, 12-40%, collapsible) + main panel (75%). Shared across ChatPage and ProjectPage via layout route — sidebar persists across navigation.
- Sidebar/dashboard session rows are rendered from persisted SQLite metadata first (`name`, timestamps, last-message preview, stats, git info); opening a chat triggers lazy hydration/boot for that session instead of startup doing full transcript replay for every session
- `InstanceView` shows a session-scoped loading panel while the first `instance_history` replay is in flight, so lazy hydration does not render as a blank chat page
- **InstanceView**: When sidecar is visible, `Group` wraps chat panel (72%) + sidecar panel (28%, 15-40%, collapsible)
- Mobile (<=768px): No resizable panels — falls back to existing full-width/overlay behavior
- Both sidebar and sidecar panels are collapsible (`collapsible collapsedSize={0}`)

### Session Cost & Token Tracking

- `SessionStats` type on `InstanceInfo.stats`: `inputTokens`, `outputTokens`, `cacheCreationTokens`, `cacheReadTokens`, `costUSD`, optional `contextTokens`, optional `contextWindow`
- `estimateCost()` in `tools.ts`: pricing table keyed by model prefix (`Codex-opus-4`, `Codex-sonnet-4`, `Codex-haiku-4`), fallback to Sonnet pricing
- **ClaudeProcess**: Accumulates usage from `assistant` events (`event.message.usage/model`) and `result` events (`event.usage/model`). Emits `"stats"` event.
- **InstanceManager**: Wires `proc.on("stats")` → `instance.info.stats`, broadcasts via `instance:status`. JSONL `parseJsonl` and `convertJsonlEntry` extract usage from assistant entries into `ctx.stats`. JSONL watcher also accumulates incrementally.
- **UI header**: `{tokens} tokens · ~${cost}` displayed between status badge and debug button (hidden on mobile). Hover tooltip shows breakdown by category.

### Composer Controls

- `InstanceInfo` carries both `preferredModel?: string` and `reasoningBudget?: number`
- UI: `InputArea` shows a combined provider/model picker for managed instances; models stay switchable, while choosing another provider starts a new managed chat instead of rewriting the current session
- UI: provider switching can optionally carry over recent portable context (recent user/assistant turns, transcript results, and changed files) via `session-handoff.ts`
- Managed sessions expose preset reasoning effort controls in the shared toolbar
- Codex sessions expose curated model selection and the shared reasoning picker through the composer controls
- `GET /api/provider-models?provider=...` returns provider-scoped model metadata for the picker. Codex uses a built-in catalog filtered by best-effort `codex app-server` discovery when available, and falls back to the built-in list on discovery failure
- UI: `InputArea` now uses a Lexical-based `ComposerEditor` so inline path mentions can render as atomic chips without giving up plain-text message semantics
- UI: markdown-rendered absolute local file links in assistant messages are intercepted client-side and sent to `POST /api/open`, which asks the OS to open the path natively instead of routing the SPA to that pathname
- `project-opener.ts` backs `GET /api/open-targets?path=...` and target-aware `POST /api/open`; chat/project headers use it for a remembered per-project `Open in` menu (preferred app persisted in `project-open-preferences.json` next to the relay DB)
- UI: the composer supports slash commands: `/model ...` for provider-appropriate model choices and `/reasoning <default|low|medium|high|max>` for managed sessions
- UI: typing `@` opens a workspace search palette backed by `GET /api/workspace-entries`; selecting a result inserts an inline mention chip but still sends plain `@path/to/file` text to Codex
- Reasoning presets are shown as effort levels (low/medium/high/max), mapped to underlying token budgets and sent over WS as `set_reasoning_budget`
- `InstanceManager.setModel()` and `InstanceManager.setReasoningBudget()` persist both preferences to SQLite and rebroadcast `instance:status`
- CLI provider: `ClaudeProcess.send()` applies `--model <id>` and `--max-thinking-tokens <budget>` on each turn
- SDK provider: `ClaudeSdkSession` forwards changes with `query.setModel(...)` and `query.setMaxThinkingTokens(...)`
- SQLite persistence: schema v6 adds `reasoning_budget` alongside `preferred_model`
- Workspace search: `workspace-entries.ts` indexes the active instance CWD via `git ls-files` when possible, falls back to a bounded recursive walk, caches results for 15 seconds, and returns scored file/folder matches

### Image Attachment

- Users can attach images via clipboard paste, file picker button, or drag-and-drop in the input area
- Images are uploaded to `POST /api/upload` as raw binary (validated image MIME type, 10MB limit)
- Uploaded files stored at `~/.Codex-relay/uploads/{uuid}{ext}`
- Upload returns `{ path: "/absolute/path" }` — these server-side paths are sent in the WS `instance_message`
- `InstanceMessagePayload` and `UserMessage` both have optional `images?: string[]`
- `InstanceManager.sendMessage()` appends `[Image: source: /path]` markers to the message text
- Codex receives the file paths in the message and reads them via its Read tool
- `ClaudeProcess.send()` signature unchanged — images are embedded in the text, not piped via stdin

### WebSocket Protocol

- Clients authenticate via session cookie on WS upgrade
- Subscription model: clients send `subscribe`/`unsubscribe` with instanceId
- Instance output/activity/exit go only to subscribers
- Status/create/remove events broadcast to all clients
- Managed provider requests are answered with `{ type: "respond_to_request", instanceId, requestId, decision }`

### Agent Transcript Messages

- When Codex runs background agents (`Task` with `run_in_background: true`), the CLI injects a user message: `Full transcript available at: /path/to/file`
- `TRANSCRIPT_AVAILABLE_RE` in `instance-manager.ts` detects these messages in `convertJsonlEntry()`
- `extractTranscriptResult()` reads the transcript file (JSONL format), extracts the first user message (for title) and last assistant text (the result)
- Returns a `TranscriptMessage` (`type: "transcript"`) instead of a `UserMessage` — suppresses the raw path from appearing as a user message
- If the transcript file is missing or unparseable, the message is suppressed entirely (no entry returned)
- `TranscriptMessage` is skipped by `extractLastMessage()`, `pushHistory()`, and `doRefreshTitle()` — transcripts don't become sidebar previews or instance names
- WS event: `instance:transcript` → sends `TranscriptMessage` with `instanceId` to subscribers
- UI: `AgentTranscript` component (`agent-transcript.tsx`) renders a collapsible card with "Agent result" header and markdown-rendered result body

### Permission Approval Flow

- When `dangerouslySkipPermissions` is false (default), Codex CLI denies tool use with an `is_error` tool_result
- `parsePermissionDenial()` in `tools.ts` extracts the tool name from denial messages
- `ClaudeProcess.allowedTools` accumulates approved tools; passed as `--allowedTools` on each `send()`
- **Cancel on first denial**: `ClaudeProcess.cancelForPermission()` sends SIGINT after the first permission denial to stop the retry loop (saves ~1-2k tokens per denial cycle). Subsequent denials from buffered output are suppressed via `_cancelledForPermission` flag. Close handler suppresses error events when cancelled for permission.
- **File-write grouping**: Approving any of Edit/Write/NotebookEdit approves all three (`FILE_WRITE_GROUP`)
- **`pendingPermission`**: Set on `InstanceInfo` as a `ProviderRequest` with a stable `requestId` when a managed instance needs approval; cleared on approval/decline or next user message. Broadcast via `instance:status`.
- **Permission banner**: `PermissionBanner.tsx` renders a sticky banner above InputArea with contextual labels ("edit files" / "run commands" / tool name) and an "Allow" button. Existing inline "Allow" buttons in `ActivityEntry` remain as fallback.
- `InstanceManager.respondToRequest(id, requestId, decision)` is the primary approval entrypoint. Legacy `approveToolUse(id, tool)` still maps old call sites onto the current pending request when possible.
- Accepted Claude CLI requests still add grouped tools, persist them to DB, and send a contextual retry prompt (or queue it via `pendingRetry` if the process is still running — drained when process becomes idle)
- **`allowedTools` persists in SQLite** (`allowed_tools` TEXT column, JSON array) — survives relay restarts including dev-mode hot reloads. DB schema v2 migration adds the column. Restored on managed instance startup.
- Retry message: "Permission granted for {file writes|tool}. Please continue."
- WS message: `{ type: "respond_to_request", instanceId, requestId, decision }`
- **Managed Codex limitation:** `codex exec --json` does not currently expose a reliable approval-request event that maps onto `ProviderRequest`. The current Codex adapter therefore runs with `-a never -s workspace-write` by default, or `--dangerously-bypass-approvals-and-sandbox` when `skipPermissions` is enabled. Provider-neutral approval plumbing is in place, but Codex approval parity is not yet implemented.
- **Known limitation (external sessions):** When a terminal-side Codex session prompts the user to approve a tool (e.g., "Allow Bash?"), nothing is written to the JSONL until the user responds. The relay sees the `tool_use` activity but cannot distinguish "waiting for permission" from "tool is running." This means **no banner, toast, or visual indicator** appears in the UI for permission prompts on external sessions. Only `INTERACTIVE_TOOLS` (AskUserQuestion, ExitPlanMode, EnterPlanMode) are detected because those tools _always_ block for input. Fixing this would require either an upstream JSONL event for permission prompts, or a timeout-based heuristic (tool_use without tool_result for N seconds).

### Instance Renaming

- Users can rename instances via the sidebar context menu (inline edit)
- `renameInstance(id, name)` sets `customTitle: true` on the instance, preventing auto-refresh from overwriting it
- `refreshTitle()` clears `customTitle` — explicit refresh re-enables auto-detection
- `doRefreshTitle()` skips instances with `customTitle: true`
- `customTitle` persists in the session database so it survives restarts
- WS message: `{ type: "rename_instance", instanceId, name }`

### Git Worktree Support

- `createInstance()` starts managed instances in the requested `workingDirectory`; it does not automatically create a git worktree
- Relay still preserves worktree metadata for sessions that already run in relay-managed worktrees (discovered externally, rebuilt from JSONL, or restored from SQLite)
- Relay-managed worktree path pattern: `~/.Codex-relay/worktrees/<shortId>/`
- `InstanceInfo.gitBranch` and `InstanceInfo.originalDirectory` are populated only when the session is actually tied to a relay-managed worktree
- `Instance.actualCwd` stores the worktree path only for those worktree-backed sessions (used for ClaudeProcess CWD, JSONL path encoding, resume/revive)
- `info.workingDirectory` stays as the original project directory for sidebar grouping and display
- On instance removal, `removeWorktree()` cleans up the worktree directory and deletes the branch when worktree metadata exists
- Worktree metadata persists in SQLite (`worktree_path`, `original_directory` columns, schema v3) — survives restarts
- On restore, if the worktree directory no longer exists on disk, falls back to the original directory with a warning
- UI: sidebar shows branch name with git-branch icon below instance name; header shows branch badge pill (hidden on mobile)
- **Merge to main**: Sidebar context menu action (only on instances with `gitBranch`) merges the worktree branch into the original directory's current branch, then cleans up the worktree and archives the instance
  - `mergeWorktreeBranch()` in `git.ts`: runs `git merge <branch> --no-edit` in the repo root; aborts on conflict
  - `InstanceManager.mergeInstance(id)`: validates worktree metadata, checks for uncommitted changes, merges, then calls `removeInstance()` on success
  - Rejects dirty worktrees (uncommitted changes) with a descriptive error
  - On merge conflict: aborts the merge, leaves the worktree intact for manual resolution
  - WS message: `{ type: "merge_instance", instanceId }`
  - REST: `POST /api/instances/:id/merge` → `{ success: true, targetBranch }` or `{ error: "..." }`

### Project Navigation

- **Layout route**: `routes/_app/projects/$projectId.tsx` wraps all `$projectId/*` children with shared header + sub-nav
- **Sub-nav tabs**: Overview | Plans (count) | Sessions (count · active) — pill-style with underline active indicator
- **Conditional rendering**: When `chatId` or `planSlug` params exist, layout skips header + sub-nav and just renders `<Outlet />`
- **ProjectContext**: Layout fetches `fetchProjectArtifacts(projectId)` once, provides via `ProjectContext` to all children
- **Routes**:
  - `/projects/$projectId/` → Overview (docs + integrations, no plans)
  - `/projects/$projectId/plans` → Plans list page
  - `/projects/$projectId/plans/$planSlug` → Plan detail (own header with back button to plans list)
  - `/projects/$projectId/chats` → Sessions list
  - `/projects/$projectId/chats/$chatId` → Chat view (own header)
- `resolveProjectId(slug)` resolves basenames by scanning `~/.Codex/projects/` for dirs ending with `-{slug}`
- `getProjectArtifacts(projectId)` aggregates memory, AGENTS.md, README.md, and plans for a project
- **Plans**: Slugs extracted from JSONL first 4KB → matched to `~/.Codex/plans/{slug}.md` → content + title from first `# ` heading
- **Sidebar**: Overview, Plans, and Sessions links per project group; Plans link highlighted when on any `/plans` route
- `createInstance({ resumeSessionId })` available in backend for future use — creates ClaudeProcess with `--resume <id>`

### `.Codex.json` Integration

- `readClaudeConfig()` reads `~/.Codex.json` on demand (small file, no watcher needed)
- **GitHub links**: `getGitHubLinks()` reverses `githubRepoPaths` map to `path → https://github.com/owner/repo`. Exposed via `GET /api/github-links`. Sidebar renders a GitHub icon per directory group. Project page header includes a GitHub link button.
- **MCP servers**: `getProjectArtifacts()` includes `mcpServers` from `projects[directory].mcpServers`. Project page shows an "Integrations" section with compact cards (name, type badge, URL/command).
- Types: `McpServerConfig` in `types.ts`; `ProjectArtifacts` extended with `githubUrl`, `mcpServers`.

### Beads (bd) Integration

- Projects with a `.beads/` directory are detected automatically
- `getBeadsIssues(directory)` runs `bd list --json --all --limit 0` in the project directory (5s timeout)
- Returns `BeadIssue[]` (id, title, description, status, priority, issue_type, etc.) or `null` if beads isn't present
- `beadsIssues` field on `ProjectArtifacts` — included in `getProjectArtifacts()` response
- `getBeadsDirectories()` returns directories with `.beads/` — used by sidebar to show Issues link
- `GET /api/beads-projects` returns the list of beads-enabled directories
- **UI**: Issues page (`issues-page.tsx`) groups by status (In Progress, Open, Blocked, Deferred, Closed) with collapsible description cards
- **Sub-nav**: "Issues (N)" tab shown conditionally when issues exist
- **Sidebar**: Issues link shown per project group when beads is detected
- Types: `BeadIssue` in `types.ts`; route at `/projects/$projectId/issues`

### External Session Discovery

- InstanceManager polls `ps` + `lsof` every 10s to find running `Codex` processes
- Managed instance PIDs are excluded from discovery to prevent duplicate instances
- Matches PIDs to JSONL transcript files in `~/.Codex/projects/`
- Watches JSONL files for incremental updates (2s poll)
- External sessions can be "resumed" — converts to a managed ClaudeProcess with `--resume`
- `resumeInstance()` uses atomic state transitions with rollback on failure — prevents duplicate instances
- **Directory path decoding**: `decodeProjectDir()` uses greedy filesystem-validated decode instead of naive `-` → `/` replacement. Handles dashed project names (e.g., `ghin-plus`, `Watch-List`). `readCwdFromJsonl()` reads 32KB (not 4KB) to handle large init entries. `scanAllSessions()` repairs corrupted `working_directory` values in the DB on every scan.
- `findPlanParent()` scans up to 32KB (not a fixed line count) to find plan continuation references
- **Plan-parent linking** (no stitching): `linkPlanSessions()` sets `parentSessionId` on child instances for UI display. No history merging or state mutation — each session stays independent. `parentSessionId` persists in SQLite (`parent_session_id` column, schema v4).

### JSONL Watching (`watchState`)

- `watchState` (`jsonlPath` + `fileOffset`) lives on `Instance` independently of `externalState`
- External sessions always get a JSONL watcher. Managed sessions get one once Claude transcript capture succeeds, or on restore when a persisted `transcript_path` exists.
- After resume, the watcher keeps running — picks up terminal-side changes when someone does `Codex --resume` externally
- **Dedup strategy** (two layers):
  1. While `instance.process.isProcessing` is true, the watcher advances the file offset but suppresses event emission
  2. When the process finishes (`isWaiting`), `wireProcessEvents` advances the offset to EOF so the watcher has nothing to re-read
- The UI is always the unified view — it sees output from both the relay's process and external terminal activity
- Concurrent writes (UI + terminal at the same time) are unsupported — one active writer at a time

### Session Targeting

- For Claude CLI sessions, the first message of a new instance is `Codex -p "message"` (no flags — creates a new session)
- Claude transcript capture still fires after the first response, finds the JSONL, extracts the session ID, and calls `proc.setSessionId(id)`
- For managed Codex sessions, the session ID comes from the provider runtime binding and the transcript path is resolved from `~/.codex/sessions` after the first completed turn
- Managed sessions persist provider-owned resume state separately from transcript capture, so restore no longer depends on the current default provider or an existing JSONL row
- Subsequent Claude CLI messages use `--resume <sessionId>` for precise session targeting
- **Never relies on `--continue`** after session capture — `--continue` picks up the "most recently modified" session in the CWD, which can be wrong when multiple sessions share a directory

### Instance Persistence (SQLite Session Registry)

- **SQLite has two roles**: `sessions` is a rebuildable Claude transcript index, while `managed_sessions` is the source of truth for managed-session provider bindings and restore metadata.
- `SessionDB` (in `src/core/db.ts`) wraps `better-sqlite3` with prepared statements for synchronous access. WAL journal mode, 3s busy timeout.
- **Schema versioning**: `schema_version` table tracks migrations. Current version: 10.
- **Startup sequence**: `migrateFromManifest()` (one-time import from legacy `instances.json`) → `scanAllSessions()` (discover JSONL files on disk, upsert new ones, archive missing ones) → restore active sessions.
- **`scanAllSessions()`**: Walks `~/.Codex/projects/` directories, reads `sessions-index.json` for fast metadata, compares with DB via `getJsonlPaths()`, upserts new transcript rows, repairs corrupted `working_directory` values, archives DB entries whose JSONL files no longer exist on disk. Also archives sessions from deleted directories (no longer exist on disk) and temp directories (`/tmp`, `/private/tmp`).
- **Archive model** replaces pruning: `removeInstance()` archives (sets `archived = 1`) instead of deleting. Discovery auto-unarchives if the JSONL reappears. Archived sessions are excluded from `getAllActive()` but retained in the DB.
- **Corruption recovery**: If the DB file cannot be opened, it is renamed to `sessions.db.corrupt.{timestamp}` and recreated from scratch. `needsRebuild` flag triggers a full scan.
- **Managed restore**: Reads `managed_sessions`, restores a stopped skeleton from persisted metadata only (no provider boot, no transcript parse), resolves provider-specific transcript paths when possible, and archives incomplete placeholder rows that have neither a resumable provider session nor a transcript path
- **External restore**: Creates stopped instance with `process: null`, `external: true`, and no watcher or transcript parse at startup
- **Discovery upgrade**: When a `Codex` process starts in a dir matching a restored stopped external, `upgradeRestoredExternal()` sets `externalState`, starts watcher, transitions to `idle`
- **Lazy hydration/boot**: `getHistory()` is the main on-demand hydration point. On first open it replays the transcript, restores task/file/team state, refreshes git info/stats/last message in SQLite, starts the watcher, and boots a managed provider session when resumable runtime state exists
- Managed instances are persisted into `managed_sessions` once they have resumable state (provider session ID and/or transcript path); empty placeholder sessions are not restored
- Legacy managed transcript rows are migrated into `managed_sessions` on startup when needed
- Transcript rows in `sessions` still persist provider name (`provider_name`) for Claude-indexed sessions
- `stopAll()` does NOT clear the DB — instances survive relay restarts
- `discoverExisting()` skips JSONL paths already known (managed or external) to prevent duplicates

### REST API

All routes except `/health` and `/auth` require authentication (session cookie).

| Method | Path                         | Description                                                                 |
| ------ | ---------------------------- | --------------------------------------------------------------------------- |
| GET    | `/health`                    | Health check (unauthenticated)                                              |
| POST   | `/auth`                      | Login with password                                                         |
| GET    | `/logout`                    | Clear session                                                               |
| GET    | `/api/instances`             | List all instances                                                          |
| POST   | `/api/instances`             | Create new instance (optional `resumeSessionId` to resume existing session) |
| DELETE | `/api/instances/:id`         | Remove instance                                                             |
| POST   | `/api/instances/:id/merge`   | Merge worktree branch into main and remove instance                         |
| GET    | `/api/instances/:id/history` | Get conversation history                                                    |
| GET    | `/api/stats`                 | Server stats                                                                |
| GET    | `/api/github-links`          | Map of local directory paths to GitHub repo URLs (from `~/.Codex.json`)     |
| GET    | `/api/beads-projects`        | List of directory paths that have a beads (bd) issue tracker                |
| GET    | `/api/directories`           | Known Codex project directories                                             |
| GET    | `/api/browse?prefix=...`     | Directory autocomplete                                                      |
| GET    | `/api/workspace-entries`     | File/folder search for composer `@` mentions (`instanceId`, optional `q`)   |
| GET    | `/api/provider-models`       | Provider-scoped model picker metadata (`provider`)                          |
| GET    | `/api/projects/:id`          | Project artifacts (accepts basename slug or full encoded path)              |
| POST   | `/api/upload`                | Upload image file for attachment (raw binary body, returns `{ path }`)      |
| GET    | `/api/file?path=...`         | Serve local image file (images only, under `$HOME`, 10MB limit)             |

### Testing

- Tests are plain `.js` files in `test/` that import from compiled `dist/`
- Core tests import from `dist/core/`, server tests from `dist/server/`
- The InstanceManager test uses `resolveConfig()` (server) to create config — works via structural subtyping
- JSONL history tests use fixture files in `test/fixtures/` — restored via DB to test the full parse pipeline
- Always build before testing

### Defaults

- `dangerouslySkipPermissions`: `false`
- `maxProcesses`: `15`
- `serveUI`: `true`
- `port`: `7777`
- `processTimeout`: 5 minutes
- `sessionMaxAge`: 7 days
- `rateLimitMax`: 5 per minute
- `dbPath`: `~/.Codex-relay/sessions.db`
- History capped at 1000 entries per instance

## Common Pitfalls

- **Circular imports**: Core must never import from server. Server imports from core. UI imports from core via `@shared` alias.
- **`.js` extensions**: All relative imports in TypeScript must use `.js` extensions (ESM + NodeNext resolution).
- **UI alias**: `@shared` points to `src/core/` (not `src/`). All UI type imports use `@shared/types`.
- **Build before test**: Tests import from `dist/`, not `src/`. A stale build = confusing test failures.
- **`import.meta.dirname`**: Only available in ESM. Used in `server/http.ts` for locating static assets. Path is relative to the compiled `.js` file location, not the source `.ts` file.
