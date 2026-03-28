When dogfooding Relay inside Relay, the agent is modifying the live app carrying the current session.

- The dev server does not auto-restart, but a manual restart (or `pnpm build`) will cut the connection. Keep that in mind before triggering builds mid-task.
- Be careful with shared contracts and persistence changes — keep edits compatible until all sides are updated, because breaking server/UI agreement or old/new stored-data compatibility can break the live session and existing local state.
- When debugging, consider stale local state (interrupted sessions, stale worktrees, cached metadata, persisted DB state) — dogfooding often exposes bugs caused by real accumulated state rather than clean-start behavior.
