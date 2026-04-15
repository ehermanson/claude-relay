# Cross-Chat Synthesis

## Problem

Related chats often contain overlapping conclusions, unresolved questions, and duplicated investigation work, but Relay has no way to combine them into one coherent view.

## Why This Matters

Once users have several chats around one topic, retrieval alone is not enough. Relay should help combine what those chats learned.

## User Outcomes

- Combine several related chats into one coherent summary
- See shared decisions and open questions across selected chats
- Reduce duplicate investigation when multiple chats cover the same topic

## Non-Goals

- Full workflow automation up front
- Perfect synthesis across arbitrarily many noisy chats

## Proposed UX

- Multi-chat synthesis view for selected chats, workstreams, spaces, or projects
- Narrow v1 synthesis output: summary, decisions, and open questions
- Suggested related chats when overlap is high can be a later enhancement, not a requirement for the first cut

## Key Risks

- Poor synthesis quality could hide important nuance
- Overly broad synthesis scopes will produce noisy output

## Dependencies

- Shared summary model
- Some grouping primitive or manual chat selection
- Good provenance links back to source chats

## Open Questions

- Should v1 synthesis require manual chat selection?
- What is the minimum useful chat count for synthesis to be worthwhile?
- What signals should drive related-chat suggestions later?

## Related Docs

- [Themes](../themes.md)
- [Now / Next / Later](../now-next-later.md)
- [Workstreams](./workstreams.md)
- [Spin Off To New Chat](./spin-off-to-new-chat.md)
- [Project Memory](./project-memory.md)

## Decision Log

- Initial direction: v1 synthesis should stay narrow: summary, decisions, and open questions across selected chats.
- Initial direction: synthesis is a follow-on feature from spin-off, not the same thing.
