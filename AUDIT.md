# Codebase Audit Tracker (2026-03-13)

## P0: Security & Correctness

- [x] `dangerouslySkipPermissions` defaults `true` in WebSocket (websocket.ts:185)
- [x] Upload endpoint double-response crash (http.ts:720-735)
- [x] Merge success uses `type: "error"` message (websocket.ts:347-351) — added NotificationMessage type

## P1: Architectural Refactors

- [x] Split `convertJsonlEntry` (312 lines) into 4 focused sub-methods
- [x] Deduplicate TASK_TOOLS/FILE_WRITE_TOOLS/FILE_WRITE_GROUP into tools.ts
- [x] Extract DebugModal and TerminalPermissionBar from instance-view.tsx
- [x] Further instance-view splits (InstanceHeader + SidecarToggles, useSidecarPanels hook)
- [x] Split sidebar.tsx (SidebarProjectGroup), activity-entry.tsx (activity-code.tsx)
- [ ] Split `useInstanceMessages` hook into focused hooks (message-list.tsx and input-area.tsx already well-structured)

## P2: Missing Test Coverage

- [ ] ClaudeProcess streaming tests (~5% coverage)
- [ ] InstanceManager lifecycle tests (~15% coverage)
- [ ] Zero-coverage modules: skills.ts, codex-models.ts, tunnel.ts, workspace-entries.ts, project-opener.ts
- [ ] WebSocket message type coverage gaps

## P3: Reliability & Cleanup

- [x] Process timeout not cleared on early exit (claude-process.ts)
- [x] Discovery errors silently swallowed — added debug logging
- [x] Tunnel stderr buffer unbounded — cap + stop after URL found
- [x] Missing try-catch on /auth JSON parse (http.ts)
- [x] Duplicate `formatTimeAgo` — consolidated in utils.ts (accepts number | string)
- [x] Dead code audit: ProviderRequest/BeadIssueDep/stopped all confirmed IN USE
- [x] Silent catch blocks — added debug logging to watcher + discovery
- [x] Unbounded stateCache in useInstanceMessages — LRU eviction at 50 entries
- [x] JSONL watch interval fires after instance deleted — guard on `instances.has()`

## P4: Performance & Polish

- [ ] Memoize message-list buildRows() and sidebar computations
- [ ] WebSocket operations lack acknowledgment
- [ ] Inconsistent error handling in api.ts
