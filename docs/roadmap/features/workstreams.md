# Workstreams

## Problem

Users often end up with several related chats around one topic, but spaces are too operational and too scoped to cover all of that organically.

## Why This Matters

Relay should help organize real behavior, not only ideal pre-planned workflows.

## User Outcomes

- Group related chats after the fact
- Track a shared theme or goal across several chats
- Understand shared files, status, and outcomes in one place

## Non-Goals

- Replacing spaces
- Forcing every chat into a formal hierarchy

## Proposed UX

- Lightweight workstream entity with title, description, tags, and status
- Add or remove chats manually
- Shared overview with summary, notable decisions, and related files
- Basic "start a new chat with this workstream's context" handoff path
- Optional promotion path into a formal space when that is useful, but not as an early core flow

## Key Risks

- Overlap with spaces could confuse users
- Automatic grouping could feel arbitrary if introduced too early

## Dependencies

- Clear model distinction between operational spaces and conceptual grouping
- Aggregate summaries across multiple chats

## Open Questions

- Should workstreams live at the project level only?
- What should the minimum status model be?
- Is "convert to space" a core flow or just an escape hatch?

## Related Docs

- [Themes](../themes.md)
- [Now / Next / Later](../now-next-later.md)
- [Handoff](./handoff.md)
- [Cross-Chat Synthesis](./cross-chat-synthesis.md)
- [Unified Workspace Model RFC](../../unified-workspace-model-rfc.md)

## Decision Log

- Initial direction: workstreams are conceptual grouping, not git/worktree ownership.
- Initial direction: spaces should not require workstreams, and workstreams should not be required inside spaces.
- Initial direction: defer "convert to space" until the conceptual boundary is well understood in the product.
