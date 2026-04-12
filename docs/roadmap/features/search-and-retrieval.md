# Search And Retrieval

## Problem

Relay makes it easy to accumulate many chats, but hard to find the right one later.

## Why This Matters

If users cannot recover prior work, Relay feels like a session switcher instead of a long-term coordination layer.

## User Outcomes

- Find "that chat where we discussed routing decisions"
- Find prior work by topic, file, branch, or decision
- Re-enter a project quickly after time away

## Non-Goals

- Building a generic enterprise search product
- Relying on embeddings alone with no structural ranking

## Proposed UX

- Project-first search by default, with a clear path to global search when users do not remember the project
- Results can represent chats, decisions, files, spaces, or workstreams
- Ranking should combine keyword matches, semantic similarity, recency, and structural signals like touched files and branches

## Key Risks

- Weak ranking makes the feature feel unreliable
- Search that returns only chats, not conclusions, may still feel too raw
- Slow or stale indexing will erode trust quickly

## Dependencies

- Better indexing of transcript metadata
- Shared summary and artifact extraction worth searching over

## Open Questions

- What is the minimum useful result type set for v1?
- How much indexing can happen incrementally versus batch rebuild?
- Should indexing live in the main server process or in a background worker?

## Related Docs

- [Themes](../themes.md)
- [Now / Next / Later](../now-next-later.md)
- [Search V1 Spec](./search-v1.md)
- [Unified Workspace Model RFC](../../unified-workspace-model-rfc.md)

## Decision Log

- Initial direction: treat search as retrieval across chats plus derived artifacts, not transcript lookup only.
- Initial direction: default to project-first search, with global search as an explicit broadened scope.
