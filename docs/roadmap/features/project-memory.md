# Project Memory

## Problem

Important decisions and rationale are trapped inside old chats and become hard to recover months later.

## Why This Matters

Relay is in a strong position to preserve knowledge across providers and sessions. If it does this well, it becomes materially better than raw provider UIs.

## User Outcomes

- See why a project chose X over Y
- Carry forward constraints and preferences into future chats
- Rebuild context after a long break without rereading transcripts

## Non-Goals

- Hidden automatic memory that users cannot inspect
- Replacing normal docs or ADRs entirely

## Proposed UX

- Relay proposes memory entries at natural boundaries like chat end, space completion, or workstream summary; avoid mid-conversation interruptions
- Users can explicitly save a chat insight as memory
- Users can accept, edit, merge, pin, or archive them
- Memory entries show provenance to source chats and time
- Managed sessions can use approved memory with clear user control

## Key Risks

- Unreviewable memory will not be trusted
- Low-quality extraction will create noise and drift

## Dependencies

- Good summarization and provenance
- Some retrieval layer so memories are discoverable and useful

## Open Questions

- What memory schema is worth enforcing up front?
- How much of this should be project-level versus workstream-level?
- When should Relay propose a new memory versus update an existing one?

## Related Docs

- [Themes](../themes.md)
- [Now / Next / Later](../now-next-later.md)
- [Search And Retrieval](./search-and-retrieval.md)
- [Workstreams](./workstreams.md)

## Decision Log

- Initial direction: memory should be structured and reviewable, not opaque model state.
- Initial direction: accepted memories remain editable without losing provenance back to their source chats.
