# Now / Next / Later

## Now

### Retrieval and context recovery

Make it easy to find old work and re-enter a project after time away.

- Global and per-project search across chats, spaces, and projects
- Resume-context view for "what changed, what matters, where to start"
- Search result cards that can point to chats, decisions, files, and grouped work

Current shipped slice: command-menu search for chats with project/global scope, snippet-based ranking, and best-effort landing near the matched message. Broader result types and preview flows remain follow-on work.

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

### Handoff

Make executor/reviewer/planner style workflows easier to transfer cleanly between chats.

- Explicit handoff action between chats
- Visible, editable handoff packet
- Basic handoff flows that work without larger grouping structures

### Cross-chat synthesis

Combine several related chats into one coherent view once the relevant chats are known.

- Synthesis across multiple chats in a workstream or project
- Narrow initial output: summary, decisions, and open questions
- Related-chat suggestions and duplicate-investigation detection

### Retrieval precision and richer search results

Extend the shipped V1 search loop into a stronger retrieval surface.

- Exact turn/message anchors for precise landing
- Preview / peek before full navigation
- Summary / decision hits, space hits, and file-adjacent results
- Ranking diagnostics and lightweight precision controls

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
