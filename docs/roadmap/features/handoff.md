# Handoff

## Problem

Parallel chats often lose context because there is no strong transfer mechanism between them.

## Why This Matters

Relay should make multi-chat workflows feel coherent when users split execution, review, planning, and debugging across different chats.

## User Outcomes

- Start a reviewer or follow-up chat without repeating context manually
- Transfer current state, blockers, and prior decisions cleanly
- Avoid redoing investigations that already happened elsewhere

## Non-Goals

- Full workflow automation up front
- Replacing the user's judgment about what context matters

## Proposed UX

- Explicit handoff action from one chat to another
- Generated handoff packet: goal, context, decisions, blockers, touched files, and what not to redo
- The handoff packet is a visible artifact that users can inspect and edit before reuse
- Basic handoff flows should work even without workstreams or richer memory systems

## Key Risks

- Too much generated text will make handoffs feel heavy
- Hidden or uneditable transfer state will weaken trust

## Dependencies

- Good source-chat summarization or extraction
- Clear provenance back to the source chat
- A target flow for creating or opening the follow-up chat

## Open Questions

- Should handoff be chat-to-chat only at first, or also chat-to-workstream?
- How much user editing should happen before a handoff is sent?
- Should handoff support open-in-split as a first-class target?

## Related Docs

- [Themes](../themes.md)
- [Now / Next / Later](../now-next-later.md)
- [Workstreams](./workstreams.md)
- [Cross-Chat Synthesis](./cross-chat-synthesis.md)

## Decision Log

- Initial direction: handoff should be explicit, lightweight, and reviewable.
- Initial direction: handoff should stand on its own rather than being coupled to broader synthesis features.
