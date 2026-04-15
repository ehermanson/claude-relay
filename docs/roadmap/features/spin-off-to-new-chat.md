# Spin Off To New Chat

## Problem

New follow-up threads often appear mid-chat, but opening a separate chat today is too manual and too easy to postpone or forget.

## Why This Matters

Relay should make it easy to capture a new idea, bug, or follow-up without derailing the current conversation.

## User Outcomes

- Capture a newly discovered thread in under 10 seconds
- Start a follow-up chat with just enough context to be useful
- Keep momentum in the current chat instead of switching mental context immediately

## Non-Goals

- Perfect context transfer
- Rich summarization as a prerequisite
- Replacing future true workflow-transfer needs

## Proposed UX

- Explicit `Spin Off to New Chat` action from the current chat
- Optimized for fast capture of a new thread, not full working-state transfer
- Minimal user input: likely one short ask plus optional note
- Relay can include lightweight factual context, but the flow should still feel worthwhile without strong generation quality
- Result lands as a draft in the new chat so the user can refine or send

## Key Risks

- Too much ceremony makes this worse than clicking `New Chat`
- Overloading this with workflow-transfer expectations will push it toward heavyweight context packets again
- Naming that overlaps with git/worktrees may confuse users

## Dependencies

- A low-friction new-chat creation path
- Lightweight provenance back to the source chat
- Fast draft seeding with optional source hint / anchor

## Open Questions

- Final naming: `Spin Off`, `Fork`, `Open Follow-up`, etc.
- Should the first version ask for one field or three?
- Should message-level entry exist at all, or only as an optional source anchor?
- Should open-in-split be a first-class target for spin-off?

## Related Docs

- [Themes](../themes.md)
- [Now / Next / Later](../now-next-later.md)
- [Workstreams](./workstreams.md)
- [Cross-Chat Synthesis](./cross-chat-synthesis.md)

## Decision Log

- Direction change: the original workflow-transfer framing overreached and collapsed into a glorified new-session flow.
- Current direction: optimize for “spin off a new thread from the current chat” rather than full context transfer.
- Litmus test: if this is not faster and easier than creating a new chat and typing manually, it should not ship.
