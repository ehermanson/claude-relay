# Search And Retrieval

## Problem

Relay makes it easy to accumulate many chats, but hard to find the right one later.

## Why This Matters

If users cannot recover prior work, Relay feels like a session switcher instead of a long-term coordination layer.

## User Outcomes

- Find "that chat where we discussed routing decisions"
- Find prior work by topic, file, branch, or decision

Note: "Re-enter a project after time away" was originally listed here but is now treated as a separate feature (project re-entry / briefing). Search can support re-entry later, but the primary interaction for orientation is not query-driven.

## Non-Goals

- Building a generic enterprise search product
- Relying on embeddings alone with no structural ranking
- Semantic search in v1 — deferred unless real usage shows lexical recall is the bottleneck
- Owning project re-entry — that is a separate briefing/orientation feature

## Proposed UX

- Project-first search by default, with a clear path to global search when users do not remember the project
- Results can represent chats, decisions, files, spaces, or workstreams
- V1 ranking combines lexical matches, structural signals (project, space, file overlap), and temporal shaping — semantic similarity is deferred

## V1 Delivered

The shipped V1 slice is narrower than the full feature vision:

- command-menu search available from the app shell
- project-first scope with explicit global toggle
- chat/session results with highlighted snippets and match-field hints
- lexical + structural + temporal ranking over persisted chat data
- direct navigation to the matching chat
- best-effort in-chat landing near the matched message

This is enough to validate the core retrieval loop. It is not yet the full cross-artifact retrieval surface described above.

## Likely V2 Focus

- Exact match anchors instead of best-effort row resolution after navigation
- Preview / peek UX before full navigation
- Result types beyond chats: summaries, decisions, spaces, workstreams, file-adjacent hits
- Better ranking controls, phrase handling, and diagnostics
- Retrieval-to-action flows like split-open, handoff, and synthesis
- Semantic retrieval only if real usage shows lexical recall failures

Recommended next bets:

- richer result types beyond chats
- retrieval-to-action flows like split-open, handoff, and synthesis

Those are the highest-leverage follow-ons because they improve both retrieval quality and what the user can do immediately after retrieval.

## Key Risks

- Weak ranking makes the feature feel unreliable
- Search that returns only chats, not conclusions, may still feel too raw
- Slow or stale indexing will erode trust quickly

## Dependencies

- Better indexing of transcript metadata
- Shared summary and artifact extraction worth searching over

## Open Questions

- Which non-chat result type should ship first in V2?
- Which retrieval-to-action flow should ship first in V2?
- How much preview/peek UX is worth adding before the command menu becomes too heavy?
- When would exact match anchors require new durable transcript/message identifiers?

## Related Docs

- [Themes](../themes.md)
- [Now / Next / Later](../now-next-later.md)
- [Search V1 Spec](./search-v1.md)
- [Unified Workspace Model RFC](../../unified-workspace-model-rfc.md)

## Decision Log

- Initial direction: treat search as retrieval across chats plus derived artifacts, not transcript lookup only.
- Initial direction: default to project-first search, with global search as an explicit broadened scope.
- V1 ranking is lexical + structural + temporal. Semantic search deferred unless usage proves lexical recall is the bottleneck.
- Project re-entry decoupled from search. Search is query-driven ("find the thing"); re-entry is a briefing/orientation surface ("orient me"). Shared data plumbing, separate product framing.
- Conclusion layer: lightweight summary / decision hits are still the intended next result-type expansion, but they are not part of the shipped V1 slice.
- Indexing: two-path model — metadata near-immediate, transcript content debounced. Assume interruption is normal; self-heal on startup.
- Result interaction in the shipped slice is direct navigation. Preview/peek remains the preferred follow-on interaction if added.
- Match explanation: show the most legible reason per result, not the full scoring stack. Separate product hints from engineering diagnostics.
