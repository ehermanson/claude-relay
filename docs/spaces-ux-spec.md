# Spaces UX Spec

## Goal

Make Relay spaces feel like a clear, low-friction workflow for isolated work and merging back, without forcing users to understand Git worktrees upfront.

This spec focuses on:

- what spaces are called
- what state they can be in
- where they appear in the UI
- what actions exist at each stage
- what copy should be used

This spec does not prescribe detailed visual design.

## Product framing

A space is an isolated workspace for a project. Under the hood, it is a Git linked worktree on its own branch. In the UI, Relay should treat it as a temporary-but-reviewable work area with a full lifecycle, not just a branch that disappears after merge.

Users should feel three things:

- starting a space is safe
- working in a space is clearly separate from the main workspace
- finishing a space is predictable, reversible only in Git terms, and never confusing in the UI

## Terminology

### Official terms

- `Space`: Relay product term for an isolated work area
- `Main workspace`: the project's primary working copy
- `Target branch`: the branch the space will merge into
- `Space branch`: the branch backing the space

### Internal/help text terms

When Relay needs to explain the Git model, it should use Git's real terminology:

- `main worktree`
- `linked worktree`

This should appear only in help text, tooltips, or advanced detail. It should not be the primary navigation label.

### Terms to avoid

- `main instance`
- `target directory`
- `main branch` as the primary user-facing label

Reason: the target branch may not be named `main`, and the user cares more about the main working copy than the underlying directory identity.

## Mental model

Relay should present a project as having one permanent workspace plus zero or more spaces:

- The `Main workspace` is where ongoing project work lives by default.
- A `Space` is a separate working copy for focused work.
- A space can be pushed, reviewed, merged, or abandoned.
- After merge, the space still has history and context, but it is no longer an active workspace.

The key distinction is:

- `Pushed` is a remote/publication state.
- `Merged` is a lifecycle state.

Pushing must not implicitly close or hide a space.

## Space lifecycle

### States

Relay should make the lifecycle explicit with these user-facing states:

1. `Active`
2. `Merged`
3. `Archived`

Mapping to current backend:

- `active` -> `Active`
- `completed` -> `Merged`
- `archived` -> `Archived`

### State definitions

#### Active

The space is still a live workspace.

Properties:

- worktree exists
- chats can continue
- commits/pushes are allowed
- merge is available
- delete/archive is available

#### Merged

The space branch has been merged into the target branch and the worktree has been removed.

Properties:

- read-only detail view
- chats/history remain viewable
- summary metadata remains visible
- branch/worktree actions are disabled or hidden
- space no longer appears in primary active navigation

#### Archived

The user intentionally closed the space without merging, or dismissed it from normal navigation.

Properties:

- read-only detail view
- hidden from default navigation
- still searchable in history

### Lifecycle transitions

- `Create space` -> `Active`
- `Push` -> stays `Active`
- `Merge` -> `Merged`
- `Archive/delete without merge` -> `Archived`

Optional future transition:

- `Restore` from `Archived` or `Merged` into a new active space

This future action should create a new space rather than trying to resurrect the old worktree in place.

## Navigation and information architecture

## Project-level structure

Inside a project, the UI should separate active work from historical work.

Recommended top-level structure:

1. `Main workspace`
2. `Active spaces`
3. `Chats`
4. `Closed spaces`

### Sidebar rules

#### Main workspace

Always present for git-backed projects. This is the stable anchor for the project.

Should show:

- project name
- current branch via existing git status UI
- quick action to start a new chat
- quick action to create a space

#### Active spaces

Show only spaces with `Active` status.

Should show per space:

- space name
- space branch
- activity signal
- chat count
- optional remote state badge

Sort order:

- active spaces sorted by recent activity
- tie-breaker: most recent creation

#### Chats

Standalone chats in the main workspace remain in the normal chat list.

Important rule:

- active spaces may appear above main-workspace chats in a dedicated `Active spaces` section
- merged or archived spaces must never outrank active chats in primary navigation

#### Closed spaces

Collapsed by default.

Contains:

- merged spaces
- archived spaces

Sort order:

- newest closed first

Each row should show a compact status badge:

- `Merged`
- `Archived`

This section should support:

- search
- open read-only detail view

### Chats page rules

Current behavior promotes spaces to the top of the project chat list. That is acceptable only for active spaces.

Recommended project page sections:

1. `Active spaces`
2. `Main workspace chats`
3. `Closed spaces`

Section behavior:

- `Active spaces` is visible only when at least one exists
- `Closed spaces` is collapsed by default when non-empty
- merged/archived spaces never appear mixed into the active cards list

### Mini sidebar rules

Keep the mini sidebar lightweight.

It should show:

- main workspace entry
- active spaces only

It should not show:

- merged spaces
- archived spaces

Reason: the mini sidebar is for fast context switching, not history browsing.

## Space detail page

The space detail page should be the primary place where a user understands the status of a space.

## Header content

Every space detail page should show:

- space name
- status badge
- space branch
- target branch
- creation time
- last activity time
- chat count
- remote state if available

If active, also show:

- worktree path
- diff summary
- open in editor/finder/terminal actions

If merged, also show:

- merged into branch
- merged at time
- merge method used
- merge commit, if available

If archived, show:

- archived at time
- archive reason if available in the future

## Primary actions by state

### Active space

Primary action:

- `Complete`

Secondary actions:

- `Push`
- `Create PR` or `Push & create PR`
- `Commit all`
- `View diff`
- `Rename`
- `Archive`

### Merged space

Primary action:

- none

Secondary actions:

- `View history`
- `Open merge commit`
- `Create a new space from this work`

### Archived space

Primary action:

- none

Secondary actions:

- `View history`
- `Create a new space from this work`

## Status badges and remote state

Relay should distinguish lifecycle status from remote status.

### Lifecycle badge

One of:

- `Active`
- `Merged`
- `Archived`

### Remote badge

Only for active spaces, when known:

- `Local only`
- `Pushed`
- `PR open`

Rules:

- Remote state never replaces lifecycle state.
- `Merged` is not a remote badge. It is a lifecycle badge.

## Merge UX

## Rename the action

Preferred label:

- `Complete`

Expanded label in menus/dialogs:

- `Complete and merge`

Reason:

- `Merge` is accurate but too narrow
- `Complete` reflects the user goal
- the dialog can clarify that completion merges back into the main workspace

## Merge entry points

The following entry points should exist for active spaces:

- primary button in the space header
- context menu action in the sidebar

## Merge dialog requirements

The completion dialog should include:

- clear target branch
- merge method selection
- note about auto-committing uncommitted work in the space
- note if the main workspace has uncommitted changes and merge is blocked
- concise irreversible warning

### Merge dialog copy

Title:

- `Complete this space?`

Body:

- `Relay will merge this space back into the main workspace on <targetBranch>.`
- `If this space has uncommitted changes, Relay will commit them before merging.`
- `After merge, this space becomes read-only in Relay and its separate working copy is removed.`

If there are blockers:

- `Your main workspace has uncommitted changes. Commit or stash them before completing this space.`

### Merge method options

Relay should offer:

1. `Squash and merge`
2. `Merge commit`
3. `Rebase and fast-forward`

Recommendation:

- default to `Squash and merge`

Rationale:

- spaces are often exploratory
- history inside a space may contain auto-commits or incremental noise
- squash gives a cleaner result for most users

Option descriptions:

- `Squash and merge`: `Combine the space into one commit on the target branch. Best default for focused AI-assisted work.`
- `Merge commit`: `Keep the branch history and add a merge commit. Best when the commit history is meaningful.`
- `Rebase and fast-forward`: `Replay the space commits onto the target branch and keep a linear history. Best for advanced Git users.`

### Advanced merge options

Optional advanced controls, either in an expandable section or deferred to later implementation:

- `Delete remote branch after merge`
- `Create merge commit message`
- `Edit squash commit message`

These are lower priority than the core flow.

## Post-merge behavior

This is one of the most important UX decisions.

### After successful merge

Relay should:

1. show a success toast/banner
2. redirect the user to the `Main workspace`
3. keep the merged space accessible in `Closed spaces`

Relay should not:

- silently remove the space from the product
- leave the user stranded on a now-invalid active-workspace page
- keep the merged space in the active spaces list

### Success message

Primary toast:

- `Merged "<spaceName>" into <targetBranch>`

Optional secondary actions in a banner or toast action row:

- `View merged space`
- `Open commit`

### Merged space detail page

The detail page should remain accessible and become read-only.

It should clearly communicate:

- this space is finished
- where the work landed
- how it was merged
- where to continue working now

Suggested banner:

- `This space has been merged into <targetBranch>. Continue in the main workspace.`

Primary CTA from the merged page:

- `Go to main workspace`

## Push and PR UX

Pushing is not completion.

### Push actions

For active spaces, Relay should support:

- `Push`
- `Push and create PR`

### After push

The space remains active.

UI updates:

- remote badge changes to `Pushed` or `PR open`
- PR link appears if available
- completion action remains available

### PR copy

Button labels:

- `Push`
- `Push & create PR`

Success toasts:

- `Pushed "<spaceName>"`
- `Created PR for "<spaceName>"`

## Archive UX

Users need a non-merge way to get spaces out of the active list.

Preferred destructive-ish label:

- `Archive`

Avoid:

- `Delete space` as the primary concept

Reason:

- users care about removing it from active workflow, not about whether Relay deletes metadata
- `Delete` implies total loss

### Archive dialog copy

Title:

- `Archive this space?`

Body:

- `This removes the space from active work and deletes its separate working copy without merging it into the main workspace.`
- `Chats and history remain available in Closed spaces.`

Confirm button:

- `Archive space`

If Relay keeps a hard-delete implementation internally for now, the UI should still use archive language unless metadata is truly removed permanently.

## Creation flow

Creating a space should reinforce the safety and separation model.

### Create space dialog should show

- space name
- base branch selector
- short explanation of isolation

Recommended helper copy:

- `A space is an isolated workspace for focused work. Changes here won't affect your main workspace until you complete the space.`

If the project has a configured default branch:

- `New spaces start from <branch>.`

## Search and filtering

Search should cover:

- active spaces
- closed spaces
- chats within spaces

But default ranking should prefer:

1. active spaces
2. active chats
3. closed spaces

Closed spaces should also have a dedicated filter or toggle in the full project chats page:

- `Show closed spaces`

## Empty states

### No spaces yet

Copy:

- `No spaces yet`
- `Create a space when you want an isolated workspace for a branch of work.`

CTA:

- `Create space`

### No closed spaces

Copy:

- `No closed spaces`

### Closed spaces collapsed

Label:

- `Closed spaces (<count>)`

## Suggested copy inventory

### Navigation labels

- `Main workspace`
- `Active spaces`
- `Closed spaces`

### Actions

- `Create space`
- `Complete`
- `Complete and merge`
- `Push`
- `Push & create PR`
- `Commit all`
- `Archive`
- `View diff`
- `Go to main workspace`

### Badges

- `Active`
- `Merged`
- `Archived`
- `Local only`
- `Pushed`
- `PR open`

### Metadata labels

- `Target branch`
- `Space branch`
- `Created`
- `Last activity`
- `Merge method`
- `Merge commit`
- `Worktree path`

## Implementation guidance for current Relay structure

This spec aligns with the current model and implies the following behavioral changes:

- Spaces with status `completed` should remain queryable and navigable instead of being treated as removed from the UI.
- Space lists should be split by status instead of filtering only on `isDefault`.
- On `space_completed`, the UI should redirect to the main workspace but retain a route that can render the merged space read-only.
- Sidebar and chats-page sorting should only elevate `active` spaces.
- Completion should accept a merge strategy parameter instead of assuming one merge mode.

Current relevant implementation points:

- status model: `src/core/types.ts`
- backend lifecycle: `src/core/space-manager.ts`
- project chats grouping: `ui/src/pages/chats-page.tsx`
- sidebar project grouping: `ui/src/components/layout/sidebar-project-group.tsx`
- space detail route: `ui/src/routes/_app/projects/$projectId/spaces/$spaceId/index.tsx`
- merge confirmation dialog: `ui/src/components/spaces/confirm-merge-dialog.tsx`

## Non-goals

- defining final visual styling
- introducing a full PR review workflow
- redesigning the entire project navigation model
- exposing raw Git terminology in primary navigation

## Open implementation questions

These do not block the spec, but they should be settled during implementation:

- whether `Archived` should include both user-abandoned and system-cleaned spaces, or whether those should split later
- whether merged spaces should expose raw diff snapshots after worktree removal, or only metadata plus chat history
- whether Relay should persist PR URL / remote branch metadata for closed spaces
