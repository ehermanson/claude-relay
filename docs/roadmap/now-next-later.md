# Now / Next / Later

## Now

### Retrieval and context recovery

Make it easy to find old work and re-enter a project after time away.

- Global and per-project search across chats, spaces, and projects
- Resume-context view for "what changed, what matters, where to start"
- Search result cards that can point to chats, decisions, files, and grouped work

### Workstreams and chat grouping

Support organic grouping for related chats without requiring a space up front.

- Lightweight workstream entity separate from spaces
- Manual grouping and labeling of chats
- Shared status and summary at the group level
- Basic handoff primitive from a workstream into a new chat

## Next

### Structured project memory

Turn chat history into durable, reviewable project knowledge.

- Proposed memories for decisions, constraints, preferences, and open questions
- Accept/edit/archive flows
- Provenance back to source chats

### Handoff and cross-chat synthesis

Make executor/reviewer/planner style workflows easier to transfer and combine.

- Explicit handoff action between chats
- Synthesis across multiple chats in a workstream or project
- Related-chat suggestions and duplicate-investigation detection

## Later

### Operational awareness

Improve visibility into stale state, session health, overlap, and drift.

- Cheap stale-session indicators should ship as soon as they are reliable, even before the broader awareness feature set
- Stale or interrupted session indicators
- Warnings when summaries or memories may be outdated
- Overlap/conflict hints for active chats touching similar areas

### Mobile companion

Extend access to Relay without recreating the full desktop app.

- Search, read, resume, and monitor
- Quick replies and approval flows
- Notifications for approvals, completions, and handoff-ready work
- Remote-friendly companion UX built on the same server

## Notes

- Search, memory, grouping, and handoff should compound into a stronger continuity story.
- Spaces remain the operational git/worktree abstraction. Workstreams should be a lighter conceptual layer that also works outside spaces.
