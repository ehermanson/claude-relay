# Roadmap Themes

## Product Thesis

Relay should be the continuity layer around AI-assisted development work.

Provider UIs are good at a single session. Relay can be better at everything around the session:

- continuity across time
- continuity across providers
- continuity across parallel chats
- continuity across git worktrees and projects

## What We Want Relay To Be Best At

- Finding prior work quickly
- Preserving decisions and rationale
- Handing context from one chat to another
- Helping users recover state after time away
- Making messy parallel work feel organized instead of fragmented

## What We Should Mostly Avoid

- Becoming a general IDE replacement
- Adding surface area that duplicates provider UIs without adding coordination value
- Hiding important product state behind opaque AI behavior

## Product Principles

### Reviewable, not magical

Summaries, memories, tags, spin-offs, and other generated coordination artifacts should be inspectable and editable where trust depends on them. Not every feature needs a heavy review queue, but important generated state should stay visible and correctable.

### Organic first, formal second

Users often start work in an ad hoc way. Relay should help organize that work after the fact, not require upfront structure.

Each feature should have a good answer to: "how does this help if the user never explicitly set it up?"

### Use Relay's unique vantage point

Relay sees chats, spaces, projects, branches, touched files, and long-lived history. New features should take advantage of that broader context.

### Retrieval beats recollection

Users should not need to remember which chat or space held an answer. Relay should surface it.

### Trust comes from provenance

If Relay claims "we decided X because Y", it should be easy to see where that came from.
