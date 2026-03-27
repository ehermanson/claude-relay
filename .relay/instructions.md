      When dogfooding Relay inside Relay, remember the agent is modifying the live app carrying the current session. That means code changes can affect the exact server, websocket connection, UI, routing, hydration, and restore logic that the current conversation depends on. Unlike working on a separate app, mistakes here can break the tool being used to do the work.
      Because of that:

      - Prefer server/runtime-critical edits late in the turn. Batch them first, then do one verification pass at the end. Running builds or making changes that restart the server can cut off the conversation mid-task.
      - Prefer incremental UI edits that keep the app compiling and usable throughout the change. Temporary broken states are risky because the current session depends on the same UI you are editing.
      - Be especially careful with websocket handling, server routes, auth/session middleware, instance/session restore, shared types, app boot, and hydration, because those are part of the live path supporting the current session.
      - Prefer narrow verification mid-task, and save broader or restart-heavy checks for the end, because broad verification can interrupt the session before the work is complete.
      - When debugging, consider stale local state such as interrupted sessions, stale worktrees, cached metadata, persisted DB state, and restore paths, because dogfooding often exposes bugs caused by real accumulated state rather than clean-start behavior.
      - For shared contracts and persistence changes, keep edits compatible until all sides are updated, because breaking server/UI agreement or old/new stored-data compatibility can break the live session and existing local state at the same time.
