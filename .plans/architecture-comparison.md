# Architecture Comparison: claude-relay vs t3code vs CodexMonitor

## Overview

Analysis of how [t3code](https://github.com/pingdotgg/t3code) and [CodexMonitor](https://github.com/Dimillian/CodexMonitor) handle session management, and how their approaches compare to ours — particularly around the managed vs external session split.

## Provider Integration

| Provider   | claude-relay                                                       | t3code                                               | CodexMonitor                                      |
| ---------- | ------------------------------------------------------------------ | ---------------------------------------------------- | ------------------------------------------------- |
| **Claude** | `@anthropic-ai/claude-agent-sdk` `query()` (feat/agent-sdk branch) | `@anthropic-ai/claude-agent-sdk` `query()` (PR #179) | N/A                                               |
| **Codex**  | `codex exec --json` subprocess (process-per-message)               | `codex app-server` persistent JSON-RPC over stdio    | `codex app-server` persistent JSON-RPC over stdio |

For Claude, we've converged on the same integration point as t3code — the Agent SDK's `query()` function with `canUseTool` callbacks, prompt queues, and typed `SDKMessage` streams.

For Codex, t3code and CodexMonitor both use the richer `app-server` protocol while we spawn a fresh `codex exec --json` process per message. See "Codex App-Server Upgrade" below.

## Session Management Model

| Aspect                     | claude-relay                                               | t3code                                               | CodexMonitor                       |
| -------------------------- | ---------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------- |
| **Managed sessions**       | ✅ Create & control via SDK/CLI                            | ✅ Create & control via SDK/app-server               | ✅ Create & control via app-server |
| **External discovery**     | ✅ `ps` scanning + JSONL dir watching                      | ❌ None                                              | ❌ None                            |
| **Session reconciliation** | Managed ↔ external dedup, PID exclusion, archive/unarchive | N/A                                                  | N/A                                |
| **Data source of truth**   | JSONL files on disk (SQLite is rebuildable cache)          | SQLite event store (event-sourced, no JSONL reading) | The Codex CLI itself (no local DB) |

**Neither competitor attempts external session discovery.** Every session they know about was created through their own orchestration layer.

## What They Do Better

### 1. No external discovery = no entire bug category

- No duplicate instance race conditions (PID tracking, managed PID exclusion)
- No JSONL path guessing before session ID capture
- No managed→external reconciliation or archive/unarchive logic
- No `decodeProjectDir()` lossy path decoding
- No `scanAllSessions()` repair cycles

### 2. Session state from protocol, not scraped from files

- Typed events from SDK/JSON-RPC, never parsing JSONL after the fact
- Permission flow is clean request/response (callback or RPC), not file-watching + retry queuing

### 3. t3code: Event sourcing (clean, possibly overkill)

- Single SQLite event store → derived projections → read model rebuilt on startup
- Commands validated → produce events → project into tables
- Strong auditability, idempotent command processing
- 13 migrations and substantial infrastructure for what is ultimately a CLI wrapper

### 4. CodexMonitor: Radical simplicity

- No database at all — just `workspaces.json` (list of directories)
- Thread state fetched on-demand from app-server via RPC
- The CLI owns all persistence; CodexMonitor is a pure thin client

## What They Don't Do (that we do)

1. **No external session visibility** — sessions started in a terminal are invisible
2. **No multi-session monitoring dashboard** — not designed as a "control tower" for concurrent sessions
3. **No remote access / tunneling** (cloudflared)
4. **No team/agent activity tracking** (Task/TeamCreate/SendMessage tool event trees)
5. **No JSONL-level session archaeology** — can't surface yesterday's terminal sessions
6. **No token/cost tracking** (t3code; CodexMonitor tracks usage locally)

## Codex App-Server Upgrade

### Current state (`codex exec --json`)

- Process-per-message: each `send()` spawns a new process
- No permission/approval channel (`addAllowedTool()` is a no-op)
- No streaming text (only complete `item.completed` events)
- stdin is `"ignore"` — can't interact with a running process

### What app-server would give us

- Persistent JSON-RPC connection (no process churn)
- `requestApproval` notifications → permission flow matching Claude SDK's `canUseTool` pattern
- Streaming `item/textDelta` notifications
- Bidirectional RPC: `thread/start`, `thread/resume`, interrupt, stop

### Estimated effort: Small

- `codex-models.ts` already speaks JSON-RPC to `codex app-server` for model discovery
- `ProviderSession` interface already supports everything needed (permissions, streaming, resume)
- `createProviderSession()` has a clean provider branch — one-line swap
- One new file (`codex-app-server.ts`), mapping JSON-RPC notifications to existing event contracts
- The hard part (provider abstraction, UI wiring, permission flow) is done from Claude SDK work

### Open question

The migration plan's Phase 7 originally targeted app-server but was deferred as "Future" when `codex exec --json` proved sufficient for initial rollout. The provider abstraction was explicitly designed so this swap is localized.

## Key Takeaway

The managed session architecture on this branch (Claude SDK + provider abstraction) is already on par with what t3code is building. The remaining architectural question is about **external session discovery** — whether it's worth the complexity it adds, and if so, whether it should remain deeply integrated or become a read-only overlay layer. That's a separate discussion.
