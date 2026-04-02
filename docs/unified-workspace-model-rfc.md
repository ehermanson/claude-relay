# RFC: Unified Workspace Model for Spaces Hardening

## Status

Draft

## Summary

Relay's current Spaces implementation is functionally useful but structurally fragile. The core problem is that a non-default Space is not modeled as the single canonical owner of its chats and execution environment. Instead, Space identity is reconstructed from overlapping fields such as `space_id`, `working_directory`, `original_directory`, `worktree_path`, `project_directory`, and `git_branch`.

This RFC proposes a unified backend Workspace model:

- Every chat belongs to exactly one workspace
- The default project flow is backed by a default workspace
- Non-default spaces are isolated workspaces with a worktree
- The UI keeps two distinct experiences:
  - default workspace renders as today's "main project" chat flow
  - isolated workspaces render as today's focused "space" UI

This unifies the data model without forcing the main branch into the current Space UX.

## Terminology

To keep the layers distinct:

- `Space` is the product and UI term
- `Workspace` is the canonical backend/domain model
- `Worktree` is the git implementation detail used by isolated Workspaces

In practice:

- the default Workspace is presented in the UI as the current main project flow, not as a Space row
- a non-default isolated Workspace is presented in the UI as a Space
- a Worktree may back an isolated Workspace, but a Workspace is not synonymous with a Worktree

## Problem

Several recurring bugs trace back to the same architectural weakness:

- Spaces disappear from the sidebar or recover under the wrong project
- chats leak out of a Space and render as top-level project chats
- Space pages are slower than they should be because membership and summaries are recomputed from mixed sources
- stale or missing Worktree paths can cause a Space chat to fall back to the main repo, breaking isolation

Today, the system relies on a mix of explicit and inferred identity:

- explicit: `space_id`
- inferred:
  - `worktree_path === instance.workingDirectory`
  - `original_directory === project_directory && git_branch match`
  - recovery logic derived from branch naming or worktree basename

This means correctness depends on every persistence, restore, recovery, and UI path agreeing on multiple correlated fields. Once those fields drift, Relay enters "repair by inference" mode.

## Goals

- Make workspace ownership canonical and explicit
- Preserve the current "main project" UX
- Preserve the current focused non-default Space UX
- Fail closed when workspace isolation is broken
- Make recovery deterministic and repairable
- Reduce live recomputation for sidebar and space views
- Add invariants and tests around restart, restore, and recovery

## Non-Goals

- Renaming Spaces to Workspaces in the product UI right now
- Forcing default/main into the non-default Space tab UI
- Eliminating recovery logic entirely
- Redesigning all project navigation at once

## Current Failure Modes

### 1. Space identity is not canonical

Space membership is sometimes stored, sometimes inferred. Both server and client contain fallback matching logic. This creates split-brain behavior where different layers can disagree about whether a chat is inside a Space.

### 2. Project identity and worktree identity can drift

Relay Worktree paths can temporarily behave like project roots during creation, restore, or recovery. That makes Space rows or sessions attach to the wrong project directory and disappear from the intended sidebar group.

### 3. Isolation can fail open

When a worktree path becomes stale, the current behavior often prefers continuity by falling back to `original_directory`. That preserves access to the chat, but it also allows future actions to target the main repo, which is the wrong safety tradeoff for isolated workspaces.

### 4. UI membership is reconstructed client-side

The sidebar and Space views merge live instances, persisted summaries, and Space metadata, then infer ownership again. This creates more opportunities for duplicates, leaks, and ordering bugs.

### 5. Space views do too much on demand

Space pages currently combine:

- server-fetched Space detail
- server-fetched Space chat summaries
- websocket live instances
- diff polling
- hydration-driven git enrichment

The result works, but it does too much identity reconstruction and repeated aggregation on hot paths.

## Proposed Model

### Core entities

#### Project

Owns long-lived repo-level identity and settings:

- `id`
- `directory`
- `repoRoot`
- project settings

Projects do not directly own chats. They own Workspaces.

#### Workspace

Owns execution root, branch identity, and chat membership:

- `id`
- `projectId`
- `projectDirectory`
- `workspaceRoot`
- `worktreePath`
- `gitBranch`
- `isDefault`
- `status`
- `displayMode`

Suggested `status`:

- `active`
- `broken`
- `completed`
- `archived`

Suggested `displayMode`:

- `main`
- `isolated`

`displayMode` is a UI hint, not a separate ownership model.

#### Chat

Every chat belongs to exactly one workspace:

- `id`
- `workspaceId`
- provider/runtime metadata
- transcript metadata

For non-default workspaces, `workspaceId` is mandatory. For the default workspace, `workspaceId` is also mandatory internally even though the UI may still present it as "main project".

## UX model

The backend model is unified. The UI remains dual-mode.

### Default workspace UX

The default workspace should render like today's main project experience:

- project-centric navigation
- long-running / one-off / braindump chat list
- no explicit "main space" row in the sidebar
- no forced space tabs UI

### Isolated workspace UX

Non-default workspaces keep the current focused space behavior:

- dedicated sidebar rows
- tabbed chat view
- merge/complete/archive actions
- isolated worktree semantics

This gives us one ownership model with two presentation modes.

## Behavioral rules

### Workspace ownership

- Every chat must have a canonical `workspace_id`
- The client should never infer workspace membership from path or branch
- The server may use inference only in migration or repair paths

### Execution root

- Default workspace executes in `projectDirectory`
- Isolated workspace executes in `worktreePath`
- If an isolated workspace does not have a usable `worktreePath`, it is `broken`

### Broken workspaces

If an active isolated workspace loses its worktree:

- allow transcript/history browsing
- allow metadata viewing
- block send/create/commit/push/merge
- surface actions:
  - `Repair Workspace`
  - `Delete Workspace`

Repair should attempt:

1. reattach an existing worktree if found
2. recreate the missing worktree from saved branch metadata
3. relink affected chats to the repaired workspace

Current user preference: broken workspaces should be repairable in place for now. Archive/recreate may become the long-term default once the repair path is proven.

### No fail-open fallback

Relay must not silently redirect an isolated workspace chat to the main repo when the worktree is stale or missing. That protects isolation even if it is more disruptive in the short term.

## Data model changes

### Short-term

Keep the existing `spaces` table, but treat it as the canonical Workspace table in practice.

Required changes:

- require `space_id` on all non-default-Space chats at creation and persistence time
- ensure restored chats keep `space_id`
- stop relying on branch/path inference in normal rendering paths
- normalize project/worktree directories before writing space ownership

### Medium-term

Potential schema cleanup:

- rename `spaces` to `workspaces`, or keep the table name and document it as the canonical workspace table
- add:
  - `display_mode`
  - `status = broken`
  - `workspace_root`
  - optional repair metadata fields

Potential chat-side cleanup:

- replace scattered semantics of `working_directory`, `original_directory`, and `worktree_path` with:
  - canonical workspace reference
  - runtime cwd
  - optional actual execution cwd

## Server responsibilities

The server should become the only source of truth for:

- workspace membership
- sidebar-ready workspace summaries
- workspace health / broken state
- whether a chat can write

The client should consume explicit server-authored data instead of recomputing it.

### Sidebar/server summary payload

The server should maintain and emit per-workspace aggregates incrementally:

- workspace id
- display name
- default vs isolated
- status
- health
- last activity
- chat ids
- active chat count
- dirty state
- diff summary

This avoids rebuilding the same information from mixed persisted/live sources in the UI.

## Invariants

The following invariants should be enforced in code and tests:

- every chat belongs to exactly one workspace
- every non-default workspace chat has non-null `space_id`
- a chat cannot appear in both main navigation and isolated workspace navigation
- an active isolated workspace chat must execute in that workspace's worktree
- a relay worktree path must never become a long-lived project root
- default workspace is never rendered as a standalone active space row
- completed and archived workspaces are read-only
- broken workspaces are read-only except for repair/delete actions

## Migration strategy

### Phase 1: Canonical membership

- make `space_id` required for all non-default workspace chats
- stamp it at create time, restore time, and persistence write time
- remove client-side fallback membership inference from hot paths

Expected benefit:

- fixes chat leakage into main nav
- fixes disagreement between sidebar and Space view

### Phase 2: Fail-closed isolation

- introduce `broken` status
- stop falling back from missing worktree to main repo
- expose read-only broken-workspace UX with repair/delete actions

Expected benefit:

- prevents isolated chats from mutating the main repo

### Phase 3: Server-authored workspace summaries

- move sidebar/grouping ownership and Space summary aggregation fully server-side
- emit workspace-aware payloads over REST/WS

Expected benefit:

- reduces duplication, leaks, and ordering bugs

### Phase 4: Performance pass

- cache and incrementally update workspace aggregates
- reduce repeated diff polling and reconstruction
- measure hydrate, list, diff, and open-Space latency

Expected benefit:

- addresses "Spaces are slow" as a first-class architecture concern

### Phase 5: Schema and naming cleanup

- decide whether to rename "spaces" internally to "workspaces"
- keep current product terminology in UI if desired

Expected benefit:

- aligns code semantics with the actual architecture

## Testing plan

Add restart/recovery tests that exercise the product as users experience it:

- chat created in isolated workspace never targets main repo
- restore with valid worktree keeps workspace ownership
- restore with missing worktree marks workspace broken
- repair restores write capability without moving chats to main
- relay worktree path never survives as a project root
- sidebar and Space view agree on membership after restart
- merged/completed workspace stays closed after restart
- broken workspace remains readable but blocks writes

Prefer tests that cross persistence + restore + UI-facing summaries over isolated helper-only tests.

## Observability

Add counters/logging for:

- recovered workspaces
- repaired workspaces
- broken workspaces detected
- invalid workspace membership rows
- attempts to write into broken workspaces
- attempts to assign relay worktree paths as project roots

This should let Relay detect drift before users experience it as "missing Spaces" or "chat leaked out".

## Open Questions

### 1. Internal naming

Should the backend rename `spaces` to `workspaces`, or should we preserve the table/type names and simply document the concept more clearly?

Recommendation: defer rename until after Phase 3. The architecture change matters more than the label.

### 2. Broken workspace repair UX

Should repair be automatic when Relay can confidently recreate the missing worktree, or should it always require explicit user confirmation?

Recommendation: explicit user action first. Automation can come later.

### 3. Default workspace lifecycle

Should the default workspace have its own explicit row for every project?

Recommendation: yes internally, because it makes ownership uniform. Keep it hidden behind the main project UX externally.

## Recommendation

Adopt a unified workspace ownership model in the backend while preserving dual-mode UI:

- default workspace -> today's main project experience
- isolated workspace -> today's Space experience

The key design principle is:

`one ownership model, multiple presentation modes`

That gives Relay the correctness and recovery benefits of a first-class workspace architecture without forcing users into a one-size-fits-all interface for main-branch work.
