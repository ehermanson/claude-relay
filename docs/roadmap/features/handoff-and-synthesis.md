# Handoff And Synthesis

## Problem

Parallel chats often duplicate work or lose context because there is no strong transfer mechanism between them.

## Why This Matters

Relay should make multi-chat workflows feel coherent, especially when users split execution, review, planning, and debugging across different chats.

## User Outcomes

- Start a reviewer or follow-up chat without repeating context manually
- Combine several related chats into one coherent summary
- Avoid redoing investigations that already happened elsewhere

## Non-Goals

- Full workflow automation up front
- Replacing the user's judgment about what context matters

## Proposed UX

- Explicit handoff action from one chat to another
- Generated handoff packet: goal, context, decisions, blockers, touched files, and what not to redo
- The handoff packet is a visible artifact that users can inspect and edit before reuse
- Multi-chat synthesis view for workstreams, spaces, or projects
- Suggested related chats when overlap is high

## Key Risks

- Poor synthesis quality could hide important nuance
- Too much generated text will make handoffs feel heavy

## Dependencies

- Shared summary model
- Workstream or related-chat grouping primitives
- Good provenance links back to source chats

## Open Questions

- Should handoff be chat-to-chat only at first, or also chat-to-workstream?
- How much user editing should happen before a handoff is sent?
- What signals should drive related-chat suggestions?

## Related Docs

- [Themes](../themes.md)
- [Now / Next / Later](../now-next-later.md)
- [Workstreams](./workstreams.md)
- [Project Memory](./project-memory.md)

## Decision Log

- Initial direction: handoff should be explicit and lightweight, with synthesis as a follow-on view.
- Initial direction: v1 synthesis should stay narrow: summary, decisions, and open questions across selected chats.
