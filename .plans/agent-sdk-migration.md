# Agent SDK Migration Plan

## Goal

Replace the CLI-spawning managed session model (`claude -p --resume`) with the official `@anthropic-ai/claude-agent-sdk`, and introduce a provider abstraction so the same architecture supports both Claude and Codex (future branch).

## Current State

Managed sessions work by:

1. Spawning `claude -p --output-format stream-json` per message (`ClaudeProcess.send()`)
2. Parsing stdout line-by-line for JSON events (assistant, tool_use, tool_result, result, progress)
3. Capturing session ID by scanning JSONL files after first response (`captureSessionId`)
4. Using `--resume <id>` for subsequent messages
5. Handling permissions via SIGINT + `--allowedTools` flag on next spawn
6. Tracking state (tasks, files, team, agent progress) by intercepting tool events in the stream parser

External sessions (discovered via `ps` + JSONL watching) are unaffected by this migration.

## Agent SDK API

The `@anthropic-ai/claude-agent-sdk` exports:

- `query({ prompt, options })` → `Query` (AsyncGenerator<SDKMessage> + control methods)
- `unstable_v2_createSession(options)` → `SDKSession` (newer, session-oriented API)
- `unstable_v2_resumeSession(sessionId, options)` → `SDKSession`

Key `Query` control methods: `interrupt()`, `setModel()`, `setPermissionMode()`, `close()`, `rewindFiles()`, `stopTask()`

Key `Options` fields: `cwd`, `model`, `resume`, `resumeSessionAt`, `permissionMode`, `allowDangerouslySkipPermissions`, `canUseTool`, `hooks`, `includePartialMessages`, `allowedTools`, `maxThinkingTokens`, `env`, `mcpServers`, `agents`, `enableFileCheckpointing`

`SDKMessage` union: `assistant`, `user`, `result`, `system`, `stream_event` (partial), `tool_progress`, `tool_use_summary`, `auth_status`, `rate_limit_event`, `task_started`, `task_progress`, `task_notification`, `files_persisted`, `hook_started`, `hook_progress`, `hook_response`, `compact_boundary`, `prompt_suggestion`, `elicitation_complete`, `local_command_output`, `status`

## Architecture

### Provider Abstraction

Introduce a `Provider` interface that both Claude (Agent SDK) and Codex (future) implement:

```ts
// src/core/provider.ts

interface ProviderSession {
  /** Send a user message. Resolves when the message is queued (not when turn completes). */
  send(message: string): void;
  /** Interrupt the current turn */
  interrupt(): void;
  /** Kill/close the session */
  close(): void;
  /** Whether a turn is currently active */
  readonly isProcessing: boolean;
  /** Process PID (for discovery exclusion). Undefined for SDK-based providers. */
  readonly pid: number | undefined;
  /** Change the model for subsequent turns */
  setModel(model: string | null): void;
  /** Approve a tool for future use (SDK: updates allowedTools; CLI: adds to --allowedTools) */
  addAllowedTool(tool: string): void;
  /** Set the session ID (for CLI-based providers that discover it post-hoc) */
  setSessionId?(sessionId: string): void;
  /** Current accumulated stats */
  readonly stats: SessionStats;
}

interface ProviderSessionEvents {
  output: [OutputMessage];
  exit: [ExitMessage];
  activity: [ActivityMessage];
  stats: [SessionStats];
}
```

`ProviderSession` extends `EventEmitter` and emits the same events as `ClaudeProcess` today. This means `InstanceManager.wireProcessEvents()` works unchanged — it just wires to a `ProviderSession` instead of `ClaudeProcess`.

### Claude SDK Provider (`ClaudeSdkSession`)

New file: `src/core/providers/claude-sdk.ts`

Wraps `query()` from the Agent SDK:

- **Session lifecycle**: Single `query()` call per session. Multi-turn via async iterable prompt queue (push `SDKUserMessage` objects). No process-per-message.
- **Permission handling**: `canUseTool` callback. When `dangerouslySkipPermissions` is false and permission mode is not `bypassPermissions`, the callback emits a permission denial activity and blocks on a deferred promise. `approveToolUse()` resolves the deferred with "allow". No SIGINT, no `--allowedTools` accumulation, no retry messages.
- **Streaming**: Iterate the `Query` async generator. Map `SDKMessage` types to our existing `OutputMessage`/`ActivityMessage`/`ExitMessage` events. The mapping is similar to what `ClaudeProcess` does today with stream-json, but against typed SDK messages instead of raw JSON lines.
- **Session ID**: Available from the SDK (via `system` message or session metadata). No JSONL scanning needed.
- **Interruption**: `query.interrupt()` — clean, no signals.
- **Model switching**: `query.setModel()` — live, no process restart.
- **Resume**: `query({ options: { resume: sessionId } })` at session creation time.

### CLI Provider (`ClaudeCliSession`) — Existing `ClaudeProcess`

Rename/refactor `ClaudeProcess` to implement `ProviderSession`. This preserves the current CLI-spawning behavior for:

- Fallback when Agent SDK is unavailable
- External session resume (which already uses `claude -p --resume`)

Minimal changes — mostly adding the interface and renaming.

### InstanceManager Changes

- `createInstance()` creates a `ClaudeSdkSession` by default (falls back to `ClaudeCliSession` if SDK import fails)
- `wireProcessEvents()` accepts `ProviderSession` instead of `ClaudeProcess`
- `captureSessionId()` becomes provider-specific: SDK provider has the session ID immediately; CLI provider keeps the JSONL-scanning approach
- `approveToolUse()` calls `provider.approveTool()` instead of the current `addAllowedTool` + SIGINT + retry dance
- `resumeInstance()` creates a `ClaudeSdkSession` with `resume: sessionId`
- External session discovery (`discoverExisting`, JSONL watching) is completely unchanged
- `Instance.process` type changes from `ClaudeProcess | null` to `ProviderSession | null`

### What Gets Deleted

From `ClaudeProcess` (or the new CLI provider):

- Nothing deleted — it stays as a fallback and for external session resume

From `InstanceManager`:

- `captureSessionId()` — replaced by SDK's session ID
- `pendingRetry` queue — SDK handles approval flow synchronously
- `FILE_WRITE_GROUP` permission grouping — SDK uses `canUseTool` callback
- `allowedTools` persistence in SQLite — SDK manages permissions internally
- `cancelForPermission()` — no SIGINT needed

From `tools.ts`:

- `isPermissionDenial()` — no longer parsing error text for managed sessions (keep for external/JSONL)

### What Stays

- All JSONL parsing code (for external sessions and history replay)
- External session discovery (`ps` + `lsof` + JSONL watching)
- `watchState` and JSONL watcher (still needed for external + terminal-side changes)
- `SessionDB` and all persistence (session registry is provider-agnostic)
- All UI code (receives the same events regardless of provider)
- `tools.ts` helper functions (tool descriptions, cost estimation)
- Git worktree isolation
- All server code (HTTP, WebSocket, auth, tunnel)

## Phases

### Phase 1: Provider Interface + Claude SDK Session

1. Create `src/core/provider.ts` with `ProviderSession` interface and `ProviderSessionEvents`
2. Create `src/core/providers/claude-sdk.ts` implementing `ClaudeSdkSession`
   - Prompt queue (array-backed async iterable)
   - `SDKMessage` → relay event mapping (output, activity, exit, stats)
   - `canUseTool` callback with deferred promise for approval flow
   - Session ID extraction from SDK
   - All control methods (interrupt, setModel, close)
3. Add `@anthropic-ai/claude-agent-sdk` dependency
4. Unit tests for `ClaudeSdkSession` with a fake `Query` (same pattern as T3 Code's `FakeClaudeQuery`)

### Phase 2: Adapt ClaudeProcess to ProviderSession

1. Make `ClaudeProcess` implement `ProviderSession` interface
   - It already has `send()`, `cancel()`, `kill()`, `isProcessing`, `pid`, `setModel()`, `addAllowedTool()`, `setSessionId()`, `stats`
   - Rename `cancel()` → `interrupt()`, `kill()` → `close()` (or add aliases)
   - The event interface (`output`, `exit`, `activity`, `stats`) already matches
2. Minimal refactor — this is about interface conformance, not behavior change
3. Export both providers from `src/core/index.ts`

### Phase 3: Wire SDK Provider into InstanceManager

1. Change `Instance.process` type from `ClaudeProcess | null` to `ProviderSession | null`
2. Update `createInstance()` to create `ClaudeSdkSession` by default
   - Pass through: `cwd`, `model`, `dangerouslySkipPermissions`, `resumeSessionId`
   - SDK options: `includePartialMessages: true`, `env: process.env`
3. Update `wireProcessEvents()` to accept `ProviderSession`
4. Replace `captureSessionId()` with SDK-provided session ID (immediate, no JSONL scanning)
5. Replace `approveToolUse()`:
   - SDK provider: resolve the pending approval deferred
   - CLI provider: keep existing behavior (addAllowedTool + retry)
6. Update `resumeInstance()` and `reviveInstance()` to use SDK provider
7. Update `sendMessage()` — no more process-per-message concern; just push to prompt queue
8. Keep `discoverExisting()`, JSONL watching, external session handling completely unchanged
9. Update `pid` exclusion in discovery: SDK sessions may not have a PID (or may have one from the spawned subprocess)

### Phase 4: Permission Flow Simplification

1. `ClaudeSdkSession.canUseTool` callback:
   - If `dangerouslySkipPermissions` → always allow
   - Otherwise → emit `permissionDenied` activity, store deferred, wait for resolution
2. New method on `ClaudeSdkSession`: `approvePermission(tool)` — resolves the deferred
3. `InstanceManager.approveToolUse()` dispatches to provider:
   - SDK: `session.approvePermission(tool)`
   - CLI: existing `addAllowedTool` + retry flow
4. Remove `pendingRetry`, `cancelForPermission`, `FILE_WRITE_GROUP` from SDK path
5. Keep `allowedTools` in SQLite for CLI provider only

### Phase 5: JSONL Watcher Coexistence

1. SDK sessions still produce JSONL files (SDK option `persistSession: true` by default)
2. After session creation, read the session ID from SDK and set up JSONL watcher as before
3. Watcher dedup still works: suppress emissions while SDK stream is active, advance offset when turn completes
4. This ensures terminal-side `claude --resume` still gets picked up

### Phase 6: Tests + Cleanup

1. Update existing tests to use provider interface
2. Add integration-style tests: create SDK session, send message, verify events
3. Verify external session discovery still works alongside SDK sessions
4. Verify permission flow works for both providers
5. Clean up any dead code paths

### Phase 7: Codex Provider Stub (Future)

1. Create `src/core/providers/codex.ts` implementing `ProviderSession`
2. Uses Codex's `app-server` (JSON-RPC over stdio) — similar to T3 Code's `CodexAdapter`
3. Same event mapping pattern as Claude SDK provider
4. `createInstance()` accepts a `provider` option to choose between Claude and Codex
5. This is a separate branch/PR — the abstraction just needs to be ready for it

## File Changes

### New Files

- `src/core/provider.ts` — `ProviderSession` interface, `ProviderSessionEvents` type
- `src/core/providers/claude-sdk.ts` — `ClaudeSdkSession` class
- `src/core/providers/index.ts` — barrel export
- `test/claude-sdk.test.js` — SDK provider unit tests

### Modified Files

- `src/core/claude-process.ts` — implement `ProviderSession` interface (minor)
- `src/core/instance-manager.ts` — use `ProviderSession` instead of `ClaudeProcess`, SDK-first session creation, simplified approval flow
- `src/core/types.ts` — add `provider?: "claude" | "codex"` to `CreateInstancePayload` and `InstanceInfo`
- `src/core/index.ts` — export new provider types
- `package.json` — add `@anthropic-ai/claude-agent-sdk` dependency

### Unchanged Files

- `src/core/tools.ts` — keep all helpers (still needed for JSONL parsing + external sessions)
- `src/core/db.ts` — provider-agnostic persistence
- `src/core/git.ts` — unrelated
- `src/server/*` — server layer unchanged (same events, same WS protocol)
- `ui/**` — UI unchanged (same message types)

## Risks & Mitigations

1. **SDK size (47MB)**: Large dependency. Mitigation: it's a server-side dep, not shipped to browsers. Consider lazy `import()` if startup time is a concern.

2. **SDK stability (0.2.x)**: API may change. Mitigation: our `ProviderSession` interface insulates the rest of the codebase. SDK changes only affect `ClaudeSdkSession`.

3. **SDK bundles Claude Code**: Version coupling. Mitigation: the SDK is the officially supported integration path — Anthropic maintains compatibility. We can pin versions.

4. **Two code paths**: SDK + CLI providers. Mitigation: they share the same interface and event types. `InstanceManager` doesn't know which it's talking to. The CLI path is the battle-tested fallback.

5. **`v2` API incoming**: `unstable_v2_createSession` / `unstable_v2_resumeSession` suggest a session-oriented API is coming. Mitigation: start with `query()` (stable), but design `ClaudeSdkSession` so swapping to v2 is a localized change. The prompt-queue pattern works with both APIs.

6. **PID exclusion for discovery**: SDK sessions spawn a subprocess internally. We may need to find its PID to exclude from `ps` discovery. Mitigation: the SDK may expose it, or we can match by CWD + timing.

## Decision: `query()` vs `unstable_v2_*`

Use `query()` for now:

- Stable API, not prefixed with `unstable_`
- T3 Code uses it (proven in production-adjacent code)
- Supports everything we need: multi-turn prompt queue, `canUseTool`, resume, interrupt, model switching
- The `v2` session API (`send`/`stream` pattern) is cleaner but unstable — we can migrate to it when it stabilizes, and our `ProviderSession` abstraction makes that a localized change
