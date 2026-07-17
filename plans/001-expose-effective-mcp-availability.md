# Plan 001: Expose effective MCP availability across Providers and Chats

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report; do not improvise. Before editing code, create or pick up the corresponding Task in `.relay/tasks.json`, set it to `in_progress`, and persist the full canonical snapshot atomically. Set it to `done` only after all done criteria pass. When done, update the status row in `plans/README.md` unless a reviewer says they maintain the index.
>
> **Drift check (run first)**: `git diff --stat 5885aba..HEAD -- server/core/types.ts server/core/provider-registry.ts server/core/session-init.ts server/core/instance-manager.ts server/core/providers/claude-sdk.ts server/core/providers/codex-app-server.ts app/src/components/chat app/src/pages/global-settings-page.tsx test app/src`
> If an in-scope file changed, compare the current-state excerpts below with live code. Material mismatch is a STOP condition.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `5885aba`, 2026-07-14

## Why this matters

Relay receives MCP information today, but users cannot reliably tell which servers are configured, which are actually loaded for the current Chat, whether they are healthy, or which server produced a tool call. Codex supplies a global status snapshot while Claude mainly supplies MCP data through session initialization, and the UI reduces this to a count or compact badges. Establish a Provider-agnostic discovery model and expose it consistently before Relay attempts to own MCP configuration.

The product rule for this plan is: **available means the active Provider reports that the MCP server is loaded for the current Project or Chat**. Configured, available, healthy, and used are separate facts and must never be inferred from one another.

## Current state

- `server/core/types.ts:194-201` defines `ProviderMcpServerStatus` with a name and several optional status strings. It does not represent scope, provenance, configured/effective state, tools, or stable identity.
- `server/core/types.ts:251-265` places MCP data in `ProviderGlobalState`; the reserved `ProviderProjectState` has no useful fields.
- `server/core/types.ts:941-950` defines generic `ActivityMessage` tool events without structured MCP server identity.
- `server/core/session-init.ts:97-132,176-177` normalizes Claude-style MCP initialization data into only `{ name, status }`.
- `server/core/instance-manager.ts:2639-2697` hydrates Claude global account/rate-limit state and Codex global account/MCP/app state asymmetrically.
- `server/core/providers/codex-app-server.ts:372-390` converts Codex status rows into the thin shared type.
- `server/core/providers/codex-app-server.ts:2202-2210` flattens a structured `mcpToolCall` to generic activity and embeds the server name in `description`.
- `app/src/components/chat/context-panel.tsx:449-477` renders MCP servers as non-interactive badges.
- `app/src/pages/global-settings-page.tsx:1136-1142` renders only the server count.

Architecture constraints:

- Relay is multi-Provider. Provider-native payload parsing stays in the Provider driver; shared code consumes normalized types.
- UI controls and presentation availability derive from `ProviderCapabilities`, never Provider-name branches.
- Use **Project**, **Space**, **Chat**, **Managed session**, and **Provider** according to `UBIQUITOUS_LANGUAGE.md`. Do not call a Chat a session in user-facing copy.
- Server and CLI imports use `#core/*.js` or `#server/*.js`; do not add `../` imports.
- Reuse existing `Badge`, drawer/sidecar, status-tone, and context-panel patterns rather than introducing another component system.
- Tests import `dist/`; always run `pnpm build:server` before backend tests.

## Commands you will need

| Purpose               | Command                                                                                                                                                                 | Expected on success |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Build backend         | `pnpm build:server`                                                                                                                                                     | exit 0              |
| Focused backend tests | `pnpm exec node --import ./test/test-env.js --test test/codex-app-server.test.js test/claude-sdk.test.js test/instance-manager.test.js test/history-conversion.test.js` | all pass            |
| App tests             | `pnpm --filter relay-app test`                                                                                                                                          | all pass            |
| Typecheck             | `pnpm typecheck`                                                                                                                                                        | exit 0, no errors   |
| Format check          | `pnpm fmt:check`                                                                                                                                                        | exit 0              |
| Lint                  | `pnpm lint`                                                                                                                                                             | exit 0              |
| Full gate             | `pnpm ci-check`                                                                                                                                                         | exit 0              |

## Scope

**In scope**:

- `.relay/tasks.json` for the required Task status lifecycle
- `server/core/types.ts`
- `server/core/provider-registry.ts`
- `server/core/session-init.ts`
- `server/core/instance-manager.ts`
- `server/core/providers/claude-sdk.ts`
- `server/core/providers/codex-app-server.ts`
- Existing MCP-relevant backend tests under `test/`
- `app/src/components/chat/context-panel.tsx`
- A new focused MCP detail component under `app/src/components/chat/`
- `app/src/pages/global-settings-page.tsx`
- Focused UI normalization/component tests under `app/src/`
- `AGENTS.md`, `README.md`, and `UBIQUITOUS_LANGUAGE.md` only if the final architecture or vocabulary needs documenting
- `plans/README.md` status only

**Out of scope**:

- Adding, editing, removing, enabling, or disabling MCP server configuration
- Making Relay the source of truth for MCP configuration
- OAuth initiation, re-authentication, or reconnect actions
- Persisting credentials, environment variables, commands, URLs, or headers
- Claude `request_timeout_ms` configuration
- MCP usage analytics or historical aggregation
- New database tables or schema-version changes
- Figma/plugin/app integrations that are not surfaced by Providers as MCP servers

## Git workflow

- Use a branch such as `feature/expose-mcp-availability` if the operator requests a branch.
- Match the repository's imperative commit style, for example `Surface agent_id in Claude permission prompts`.
- Keep the shared contract/backend normalization and UI presentation as separately reviewable commits if commits are requested.
- Do not push or open a pull request without explicit instruction.

## Steps

### Step 1: Define one normalized MCP discovery contract

In `server/core/types.ts`, replace or evolve `ProviderMcpServerStatus` into a canonical MCP discovery shape. Preserve wire compatibility where practical, but make these concepts explicit:

- Stable identity derived from Provider plus Provider-reported server key/name; do not use array position.
- `provider` and `name`.
- Provider-reported scope when known: `global | project | chat`; use `unknown` rather than guessing. Do not claim Space scope unless a Provider actually reports it.
- Provenance/source when known: Provider-reported versus Relay-configured. In this plan, values will normally be Provider-reported.
- `configured`, `available`, and health/auth state as separate fields. Unknown must remain representable.
- Normalized connection state such as `connected | connecting | needs_auth | failed | disabled | unknown`.
- Optional tool descriptors with at least stable name and optional description; retain a count when only the count is available.
- Optional detail/error text safe for UI display. Never carry secrets or raw config.

Add MCP discovery metadata to `ProviderCapabilities`, sufficient for the UI to know whether a Provider supports server discovery and tool enumeration. Do not add configuration capabilities yet.

Add structured MCP metadata to `ActivityMessage` without changing the existing `activity: "tool_use" | "tool_result"` classification. Include server identity/name, tool name, and optional call ID/duration when reported.

**Verify**: `pnpm build:server` -> exit 0. Add a type-focused or normalizer test proving configured, available, and health can differ and unknown values remain unknown.

### Step 2: Normalize Codex status and activity without losing information

In `server/core/providers/codex-app-server.ts`:

- Update `buildMcpServerStatusList` to emit the canonical shared shape from `mcpServerStatus/list`.
- Map explicit Codex fields only. Do not infer `available` merely because a server appears in a configured list unless the Codex status semantics guarantee it.
- Preserve tool names/descriptions when the payload supplies them; otherwise preserve `toolCount`.
- Emit structured MCP metadata for `mcpToolCall` start, progress, and completion events. Retain useful human descriptions, but UI behavior must no longer parse those descriptions.
- Ensure cold snapshot and live-session status use the same normalizer.

Extend `test/codex-app-server.test.js` using its existing startup snapshot, elicitation, provider-status, and tool-call harnesses. Cover connected, needs-auth/failure, tool enumeration/count-only, and structured tool activity.

**Verify**: `pnpm build:server && pnpm exec node --import ./test/test-env.js --test test/codex-app-server.test.js` -> all pass.

### Step 3: Normalize Claude's effective Chat availability

Update `server/core/session-init.ts` so Claude initialization payloads produce the same canonical MCP shape. Support the already-observed array and keyed-object payload variants, but map only fields present in the payload. Treat session initialization as evidence that the Provider reported the server for that Managed session; document in code whether that warrants `available: true` based on the actual SDK semantics.

In `server/core/providers/claude-sdk.ts` and/or `server/core/instance-manager.ts`, preserve normalized session-init MCP servers in the Chat's `ProviderStatusSummary`. Do not promote Chat-scoped discovery into global state. If Claude exposes no cold global MCP query, leave global MCP state unknown rather than copying data from an arbitrary Chat.

Add cases to `test/claude-sdk.test.js`, `test/history-conversion.test.js`, and `test/instance-manager.test.js` proving live and replayed initialization yield the same Chat-level MCP state and do not contaminate another Chat or global Provider state.

**Verify**: `pnpm build:server && pnpm exec node --import ./test/test-env.js --test test/claude-sdk.test.js test/history-conversion.test.js test/instance-manager.test.js` -> all pass.

### Step 4: Resolve effective MCP state for the current Chat

Create a small pure resolver, colocated with shared MCP types or in a focused `server/core/mcp.ts` exported through the existing core barrel, that combines global Provider discovery and Chat-reported discovery without overwriting scope or unknown fields.

Rules:

- Chat-reported state wins for whether a server is available to that Chat.
- Global configured/health metadata may enrich a matching Chat server but cannot prove Chat availability.
- Servers match by stable Provider/server identity, not display label alone when a Provider supplies a key.
- Empty arrays are real snapshots and clear stale prior lists; `undefined` means no new knowledge. Update merge code accordingly because current truthiness checks can retain stale MCP state.
- Never merge MCP servers across Providers.

Write exhaustive unit tests for the resolver and stale-list clearing.

**Verify**: `pnpm build:server` plus the focused new test -> all pass.

### Step 5: Expose MCP details in Chat context

Turn the MCP area of `app/src/components/chat/context-panel.tsx` into a summary that opens a focused MCP detail drawer/popover using the existing sidecar/drawer idiom. The detail surface must show:

- Server name and Provider
- Scope/provenance when known
- Configured, available-to-this-Chat, connection, and authentication state without collapsing them into one badge
- Tool names and descriptions when enumerated, or a count/"not reported" fallback
- Provider-safe detail/error text
- Clear empty/unknown messaging, including the difference between "none reported" and "discovery unsupported"

Keep compact badges in the context summary. Status must use normalized enums rather than substring parsing of arbitrary Provider strings. Accessibility: the opener is a real button, status is not conveyed by color alone, and keyboard users can open/close the detail surface.

Do not add management actions. An informational note may say configuration is managed by the Provider when appropriate.

Add pure view-model tests or component tests following the repository's existing app-test setup. Do not introduce a new test framework.

**Verify**: `pnpm --filter relay-app test && pnpm typecheck:app` -> all pass.

### Step 6: Improve Global Settings without implying Chat availability

In `app/src/pages/global-settings-page.tsx`, replace the bare MCP count with a compact Provider-level status summary using the same normalized presentation helpers. Explicitly label it Provider-level; do not claim these servers are available in every Chat. Link or expand to names/statuses only if it fits the existing settings layout.

Render discovery UI from `ProviderCapabilities`, not `provider === "codex"` or `provider === "claude"` branches.

**Verify**: `pnpm --filter relay-app test && pnpm typecheck:app` -> all pass, and `rg -n 'provider\s*===\s*["\x27](claude|codex)' app/src/components/chat/context-panel.tsx app/src/pages/global-settings-page.tsx` finds no new MCP presentation branching.

### Step 7: Run the full gate and update documentation

Run formatting on only modified code if required, then the full CI gate. Review `AGENTS.md`, `README.md`, and `UBIQUITOUS_LANGUAGE.md`. Update them only if the MCP architecture, user-visible navigation, or new domain terms would otherwise be stale. At minimum, add MCP terminology to `UBIQUITOUS_LANGUAGE.md` if user-facing copy introduces ambiguous words such as configured versus available.

Mark the Relay Task done and update this plan's row in `plans/README.md` only after the full gate succeeds.

**Verify**: `pnpm ci-check` -> exit 0. `git diff --check` -> no output.

## Test plan

- Codex status normalization: connected, needs-auth, failed, tool-list, count-only, empty snapshot clearing.
- Codex activity: start/result retain structured server and tool identity.
- Claude session initialization: array and keyed-object payloads, live/replay parity, Chat scoping.
- Shared resolver: Chat state wins for availability; global state enriches only; unknown remains unknown; Providers never cross-merge.
- UI view model/component: discovery unsupported, nothing reported, configured but unavailable, available and connected, needs auth, failed, tool enumeration.
- Accessibility: detail opener has button semantics and an accessible name; each state has visible text.
- Use `test/codex-app-server.test.js`, `test/claude-sdk.test.js`, `test/history-conversion.test.js`, and `test/instance-manager.test.js` as backend structural patterns. Use existing Vitest-style app tests under `app/src/` for pure UI helpers.

## Done criteria

- [ ] A canonical shared MCP discovery type represents Provider, identity, scope/provenance, configured, Chat availability, normalized health/auth, and tools without requiring raw Provider payloads.
- [ ] Provider capabilities declare MCP discovery/tool-enumeration support; UI has no MCP-specific Provider-name branch.
- [ ] Claude and Codex populate the canonical type from their existing discovery surfaces.
- [ ] Empty MCP snapshots clear stale state; unknown/unsupported remains distinguishable from none.
- [ ] MCP tool activity retains structured server/tool identity through the shared event contract.
- [ ] Chat context shows which servers are actually available to the active Chat and why.
- [ ] Global Settings presents Provider-level MCP state without claiming universal Chat availability.
- [ ] No configuration, credentials, authentication action, or timeout setting is added.
- [ ] `pnpm ci-check` exits 0.
- [ ] `git diff --check` prints nothing.
- [ ] No files outside Scope are modified.
- [ ] The corresponding Relay Task and `plans/README.md` status are `done` only after verification.

## STOP conditions

Stop and report instead of improvising if:

- Claude or Codex does not expose enough information to distinguish loaded-for-Chat from merely configured. Report the exact observable payload semantics and leave availability unknown.
- Provider server identifiers are unstable or collide in a way that cannot be solved without persistent Relay-owned IDs.
- Correct replay requires a database/schema migration or a new Relay event persistence mechanism.
- The UI requires Provider-name branching because capability metadata is insufficient; extend the capability contract instead, or stop if that materially expands scope.
- Implementing discovery requires reading or writing credentials, environment values, commands, headers, or raw MCP configuration.
- Existing in-scope code materially differs from the current-state description.
- A verification step fails twice after a reasonable correction.

## Maintenance notes

- Reviewers should scrutinize every inference that sets `available: true`; it must come from Provider semantics, not presence in a configuration list.
- Empty-array versus `undefined` merge behavior is critical for avoiding stale MCP badges.
- Raw Provider status strings may be retained for diagnostics, but UI logic must consume normalized enums.
- The follow-up management task should use this contract and capability metadata to decide which Providers/scopes Relay can configure. It must separately design secret handling, auth actions, validation, and per-server settings such as Claude's `request_timeout_ms`.
