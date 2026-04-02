This space is all about improving the Space feature itself. Spaces are just git worktrees with UI on top. We want to try to make worktrees as seamless and easy to use as possible, we don't want users to have to know anything about how worktrees work under the hood; just that it's an isolated and safe place to work outside of their main copy of the project.

In particular, we want to focus _this_ space on adding features to make our Space feature smarter and more effective; with UI shortcuts for common tasks/actions; shared context between chats in the space; and the abiility for chats to communicate with each other within the space;

## 2026-03-31 Chat Purge

- Decision: removing a chat from a space should hard-delete it, not just archive/hide it. Rationale: archived transcripts were being rediscovered and could reappear outside the space as standalone chats.
- Interface: added websocket client message `purge_instance` alongside existing `remove_instance`. Space tab removal now uses `purge_instance`; generic sidebar delete still uses archive semantics.
- Server behavior: purge deletes the session/managed-session DB rows and transcript file(s), while preserving the shared space worktree.
- Status: server typecheck/build passed. Runtime DB-backed tests are currently blocked locally by a `better-sqlite3` native module / Node version mismatch.

## 2026-04-01 Space New Chat UX

- Decision: space-scoped "new chat" now keeps an explicit pending tab/body state instead of inferring the new tab from "first unseen instance". Rationale: the inferred path could briefly drop selection, navigate back to the previous chat, and later show a misleading restore/history loader.
- Interface: `SpaceViewContext.shared` now exposes `pendingNewChatId` alongside `pendingNewChatActive`; `SpaceChatTabs` consumes both so it can render and scroll a selected placeholder tab while creation is in flight.
- UI behavior: clicking New Chat in a space now shows a selected `Creating chat...` tab and a matching full-panel creating state immediately; once the websocket `instance_created` arrives, the view seeds an empty message cache and lands on the blank chat UI with suggestion cards instead of a history-loading screen.
- Status: UI typecheck passed (`pnpm typecheck`).
