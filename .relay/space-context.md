# chat-enhancements

## Goal

Refinement pass on the chat UI across the app. Improve visibility, consistency, and navigation for how we render agent interactions.

## Work Streams

### 1. Session Init Display (`system_init`)

Show the user what's available when a session starts. When we get the init response from the model/provider, render a "Session Started" panel with:

- **Tools** — listed as chips/tags (e.g. Bash, Edit, Read, Grep, Glob, WebFetch, etc.)
- **Agents** — available agent types (e.g. general-purpose, Explore, Plan)
- **Commands** — slash commands / skills available
- **MCP Servers** — connected servers and their status (connected / needs auth)
- **Raw Message** — expandable section showing the raw JSON init payload

Reference: screenshot 1 — Claude Code's "Session Started" panel with collapsible sections for each category.

### 2. Tool Call UI Refinement

We've done a few passes, but need **consistency**. Every tool call should be expandable to show:

- **Command / Input** — the full input sent to the tool, in a code block or structured view
- **Result / Output** — the full output returned, also in a collapsible code block

Right now we sometimes show this, sometimes don't. The goal is: **every** tool call, regardless of type, gets a consistent expandable detail view with inputs and outputs.

Reference: screenshot 2 — shows a Bash tool call with collapsible "Command" and "Result" sections, each showing the full content.

### 3. Compact Boundary Management

Currently when the agent compacts context, we just show a generic "working" indicator. This is confusing. We need to:

- **Clearly indicate** when compaction is happening (e.g. "Compacting context…" indicator)
- **Preserve prior messages** — do NOT blow away the chat history above the compaction point. The UI should be seamless; compaction is an internal operation, not a visual reset.
- Show a subtle boundary marker (e.g. a divider or badge) so the user knows compaction occurred, but the conversation remains scrollable and intact above it.

### 4. Chat Table of Contents (TOC)

For long chats, add a floating TOC for quick navigation:

- Treat **user messages** as anchors
- Floating popup menu (button in corner or sidebar) that lists anchors
- Each entry shows the first ~N characters of the user message (trimmed)
- Clicking an entry scrolls to that message
- Should work well with very long conversations

## Decisions

- **Stream 2 (v2)**: Tool results are merged at the **data level** in the reducer, not the UI. New `MergedActivity` type extends `ActivityMessage` with `mergedResultDetail` and `mergedResultStatus`. The reducer's `mergeToolResult()` function finds the matching `tool_use` and attaches result data directly. `tool_result` entries are never added as separate activities (except permission denials and interactive resolutions which have their own UI). This eliminates the "Tool completed" second line entirely.
- **Stream 2 (expand)**: `ALWAYS_EXPANDABLE` tools (Edit, Write, AskUserQuestion, ExitPlanMode) are always expandable. Any tool with a completed result (`resultStatus`) is expandable. When expanded: Edit/Write show diff/content directly (no Input/Result wrapper — the diff IS the content). Bash shows labeled "Command" + "Result" sections. Other tools show result directly.
- **Stream 4**: TOC appears automatically when a chat has 3+ user messages. Uses the virtualizer's `scrollToIndex` for virtualized rows and DOM `scrollIntoView` for non-virtualized tail rows.

## Status

- **Stream 1 (Session Init Display)**: Shelved. Server pipeline emits/persists `session_init` events, but the UI was removed — not useful enough to justify the screen space. Component, types, and render paths cleaned up; server-side data preserved for future debug use.
- **Stream 2 (Tool Call UI)**: Done. Data-level merge, single display name per tool, chevron expand, labeled Bash sections, Edit/Write show diffs directly.
- **Stream 3 (Compact Boundary)**: Done. Full replay history preserved, boundary divider, live compaction indicator, Codex native `/compact`, Claude live boundary, dead-stdin fix.
- **Stream 4 (Chat TOC)**: Done. Floating TOC with user-message anchors, auto-hidden under 3 messages, virtualizer-aware scrolling.

## Interfaces

### Stream 2 — MergedActivity data model

- `chat-types.ts`: `MergedActivity extends ActivityMessage` with `mergedResultDetail?: string`, `mergedResultStatus?: ResultStatus`. Used by `ActivityGroupChatItem`, `ToolGroupData`, `ToolContainerRow`.
- `use-instance-messages.ts`: `mergeToolResult(activities, result)` — mutates the matching `tool_use` in-place with result data. Called in both replay and live reducer paths.
- `activity-group.tsx`: Reads `act.mergedResultStatus` and `act.mergedResultDetail` directly from activities. No more `resultStatusMap`/`resultDetailMap`. Remaining standalone `tool_result` entries (unmerged) are hidden.
- `activity-entry.tsx`: `computeDisplayName()` produces one clean string per tool type. `group/entry` hover class, chevron on hover. `resultDetail` and `resultStatus` props fed from `act.mergedResultDetail`/`act.mergedResultStatus`. Expandable when `ALWAYS_EXPANDABLE` or has completed result.
- `tool-content.tsx`: Edit/Write show diff/content directly. Bash shows `LabeledSection` Command + Result. Other tools show result directly or input as JSON fallback. `ToolDetailSection` (collapsible) exists but unused.
- `tool-group-label.ts`, `tool-container.tsx`, `build-rows.ts`: Updated to use `MergedActivity` instead of `ActivityMessage`.

### Stream 4 — ChatTOC component

- `chat-toc.tsx`: `ChatTOC` component — props: `rows: RenderRow[]`, `onScrollToRow: (rowIndex: number) => void`.
- Integrated into `message-list.tsx` with `handleScrollToRow` callback.
- Auto-hidden when fewer than 3 user messages.

## Update 2026-04-03

### Stream 3 — Compact Boundary Management

- Replay no longer truncates everything before the last `compact_boundary`. `InstanceManager.parseJsonl()` now keeps the full transcript and converts boundary lines into a shared `system_event`.
- Performance follow-up: `parseJsonl()` keeps the old backward prescan. Pre-boundary lines now use a lightweight conversation-only pass (user/assistant text + usage), while boundary-forward lines still use the full stateful parser for tools/tasks/files.
- Shared contract: `server/core/types.ts` adds `SystemEventMessage` with `event: "compact_boundary" | "session_init"`. Current implementation only emits `compact_boundary`; `session_init` is reserved for Stream 1.
- UI contract: `use-instance-messages.ts` maps `system_event/compact_boundary` into a `compact-boundary` chat item/row. `message-list.tsx` renders it with the new `compact-boundary.tsx` divider.
- Live UX: while an explicit `/compact` turn is processing, `LiveStatusStrip` shows `Compacting context...` instead of the generic working copy.

### Status

- **Stream 3 (Compact Boundary)**: Implemented for replay + live boundary rendering. Explicit `/compact` turns show compacting copy while running.
- **Stream 1 (Session Init Display)**: Still open, but the shared `system_event` type is in place for a future `session_init` event.

## Update 2026-04-03 (Codex live compaction)

- Codex app-server does expose compaction explicitly. Current protocol support added for modern `rawResponseItem/completed` with `item.type === "compaction"` and deprecated `thread/compacted` as a fallback.
- `server/core/providers/codex-app-server.ts` now emits Relay `systemEvent`/`compact_boundary` from those protocol messages, deduped by `turnId` so listening to both paths does not produce duplicate dividers.
- `server/core/provider.ts`, `server/core/instance-manager.ts`, and `server/websocket.ts` now carry provider `systemEvent` through to subscribed clients as a first-class replayable message.
- Targeted validation: `pnpm build:server` and `pnpm exec node --import ./test/test-env.js --test test/codex-app-server.test.js` passed, including new tests for raw compaction and deprecated-event dedupe.

## Update 2026-04-03 (Codex `/compact`)

- Exact user message `/compact` now uses Codex native `thread/compact/start` when the session already has a thread ID, instead of sending `/compact` as plain chat text.
- Fallback behavior is unchanged for non-Codex providers and for Codex sessions that do not yet have a thread ID.
- `server/core/provider.ts` adds optional `compactThread()`. `server/core/providers/codex-app-server.ts` implements it. `server/core/instance-manager.ts` intercepts exact `/compact` at dispatch time and routes to the provider-native method.
- Targeted validation: `pnpm build:server` and `pnpm exec node --import ./test/test-env.js --test test/codex-app-server.test.js` passed, including a new RPC test for `thread/compact/start`.

## Update 2026-04-03 (Codex `/compact` dead-stdin fix)

- Follow-up bug: native Codex `/compact` could fail with `Process stdin not writable` after restart/revive because Relay kept the provider session wrapper and remembered thread ID, but the underlying app-server stdio transport was gone.
- `server/core/providers/codex-app-server.ts` now treats native compact like normal send: if the transport is missing, uninitialized, or stdin is no longer writable, it respawns `codex app-server`, re-initializes, resumes the existing thread, then issues `thread/compact/start`.
- Added regression coverage in `test/codex-app-server.test.js` for the dead-stdin case by making the first app-server child's stdin unwritable before calling `compactThread()`.
- Targeted validation rerun: `pnpm build:server` and `pnpm exec node --import ./test/test-env.js --test test/codex-app-server.test.js` passed.

## Update 2026-04-03 (Claude live compact boundary)

- Claude SDK already emits live `system/subtype: compact_boundary`; Relay was receiving it but dropping it.
- `server/core/providers/claude-sdk.ts` now maps that message to the shared Relay `systemEvent` contract as `event: "compact_boundary"`, so the existing compact-boundary UI works for Claude live sessions too.
- No Claude-native `compactThread()` RPC was added here; this change only confirms the shared boundary-rendering path is provider-portable.
- Targeted validation: `pnpm build:server` and `pnpm exec node --import ./test/test-env.js --test test/claude-sdk.test.js` passed, including a new live-event regression test.

## Update 2026-04-03 (Session init display — shelved)

- Server pipeline implemented: `session-init.ts` normalizes init payloads, providers emit `session_init` events, replay converts Claude JSONL init lines. All server-side code retained.
- **UI removed**: `session-init.tsx` component deleted. `SessionInitChatItem`/`SessionInitRow` types removed from `chat-types.ts`. Reducer and `message-list.tsx` no longer create or render session-init rows. Decision: the information wasn't useful enough to justify screen space.
