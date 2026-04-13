# Search V1 Spec

## Status

Implemented as a narrow V1 slice

## Goal

Make it reliably easy to recover prior work inside Relay without forcing users to remember which chat, space, or project held the answer.

V1 should feel clearly better than transcript grep, but it does not need to solve the full long-term memory problem.

This spec started broader than the shipped slice. The implementation in this worktree is the "recover the right chat quickly" cut:

- command-menu search invokable from anywhere
- project-first scope with explicit global toggle
- lexical + structural + temporal ranking over chat/session records
- snippets and match-field hints in the result list
- search result navigation into the right chat
- best-effort landing near the matched message instead of always dropping to the bottom

The broader retrieval surface below remains directionally useful, but should be read as V1 aspiration plus V2 follow-on, not a claim that every item shipped.

## Product Shape

Search is a retrieval feature, not a generic search engine.

The core promise:

- start from a project by default
- be invokable from wherever the user already is
- recover relevant prior work quickly
- surface conclusions, not just raw chats
- let users widen to global search when they are unsure where the work happened

## Primary User Jobs

### 1. Find a prior discussion

"What was that chat where we talked about routing decisions?"

### 2. Recover rationale

"Why did we choose X over Y?"

### 3. Find related work artifacts

"Show me the chat, files, and grouped work related to auth cleanup."

## V1 Scope

### In

- Header-invoked search with current-project default scope
- Clear expand-to-global search control
- Search across chats in the shipped slice
- Design the index/result model so spaces, workstreams, and derived artifacts can layer in later
- Hybrid ranking using lexical, structural, and temporal signals (semantic deferred)
- Incremental indexing for changed chats

### Out

- Full enterprise-style filters and saved searches
- Cross-user/team search semantics
- Heavy faceting UI
- Perfect answer extraction
- Search-driven automatic memory creation
- Semantic / embedding-based search (deferred unless lexical recall proves insufficient)
- Project re-entry surfaces (separate feature — search is query-driven, re-entry is orientation/briefing)

## Result Types

Shipped V1 supports chat results. The list below is the intended expansion order beyond the shipped slice.

### 1. Chat

The anchor result type. Includes:

- title or derived label
- project
- space/workstream context if present
- last activity time
- matched snippet
- touched files if available

### 2. Summary / decision hit

A derived result that points to a chat or chat group but surfaces the likely conclusion first.

This does not require the full memory/extraction system. A likely V2 approach is a lightweight conclusion layer:

- persisted chat summary if present
- derived "chat takeaway" from summary or last-turn context when available
- falls back to chat result if no summary exists

The result type can exist before standalone durable memory objects do. It points back to a chat and surfaces a conclusion-like snippet first.

### 3. Space or workstream

A container result when the grouped context itself is a better entry point than an individual chat.

### 4. File-adjacent hit

Not a full code search result. This is a "this work touched these files" affordance to help users navigate to the right conversation.

The shipped cut is narrower: `chat` first, then add the rest only when they materially improve retrieval.

## Default UX

### Invocation and scope

- Primary invocation lives in the session header or app-level header
- Search should be available from active chats and spaces without requiring navigation
- Placeholder should suggest both topical and rationale queries
- Search defaults to current project scope
- A visible control allows widening to all Relay projects

### Result interaction

Shipped V1 uses direct navigation into the matching chat. Preview/peek is a likely V2 interaction, where the preview would show:

- matched snippet with highlighted terms
- chat title, space, project, and time context
- quick actions: Open chat, Open in split, Use in handoff

If/when preview ships, full navigation should remain explicit. That avoids search becoming a context-switching trap and supports the common flow: inspect → decide → act.

### Results list

Each result card should answer:

- what is this?
- why did it match? (show the most legible reason, not the full scoring stack)
- where did it happen?
- where should I jump in?

Match explanation approach:

- **Lexical matches**: highlight matched terms in title/snippet, small label like "Matched in summary"
- **Structural signals**: show selectively as chips when high-signal — "Same project", "Recent", "Related files"
- **Blended/unclear**: use generic hints like "Related recent chat" rather than faking precision
- **Diagnostics**: full ranking breakdown belongs in logs/devtools, not in the result card

## Ranking

V1 ranking blends lexical, structural, and temporal signals. Semantic similarity is explicitly deferred — the corpus is small enough that lexical + structural + temporal should cover most retrieval needs. Semantic becomes justified only when real usage shows recall failures that these signals cannot solve.

### Lexical

- keyword match in titles, snippets, summaries, and metadata
- exact phrase match should score strongly
- FTS as the primary candidate retrieval mechanism

### Structural

- current project boost
- file overlap with current context if available
- branch / space / workstream overlap
- result type weighting, with conclusions above raw containers when confidence is high
- query heuristics where useful

### Temporal

- recency matters, but should not bury the clearly correct old result

### Semantic (deferred)

Embedding-based similarity adds significant complexity (index/storage path, freshness/rebuild, model choice, cost/privacy, harder debugging). Add only when evidence shows:

- users ask vague conceptual queries that lexical search routinely misses
- the global corpus grows enough that keyword retrieval feels brittle
- retrieval failures are recall problems, not ranking or data-shaping problems

## Indexing

Search quality depends on freshness. Stale search will lose trust quickly. Assume interruption is normal, not exceptional.

### Freshness contract

- Metadata-backed search updates (title, summary, project, space, archive state) appear near-immediately, piggybacking on existing persistence events
- Transcript-derived content updates are debounced while a chat is active (a few seconds), with a final flush on stop/exit when possible
- Interrupted sessions are repaired automatically on startup via a catch-up scan of recent/active chats
- Search is eventually correct without requiring manual cleanup
- Short lag is acceptable. Silent long-lived drift is not.

### Two-path indexing model

**Metadata path (near-immediate)**

Update on normal persistence events when any of these change: title, summary, last message text, project/space ownership, archive state.

**Content path (debounced)**

Update bounded transcript-derived body text on:
- transcript watcher/replay advancing materially
- completed output from a managed chat
- periodic debounce while a chat is active
- immediate flush on stop/exit when possible

Not on every streamed token. Not only on close.

### Rebuildability

- Persisted session rows and transcript files remain canonical
- Search index is a derived artifact that can lag temporarily
- Full rebuild from canonical sources remains available as a safety valve
- Treat rebuildability as the correctness model for interrupted state, not just a repair path

### Per-document freshness metadata

Track internally (for debugging and later trust signals):
- source last updated at
- indexed at
- indexing status if obviously behind

## Data Inputs

Likely inputs for v1:

- transcript text
- chat titles or derived labels
- project / workspace / space metadata
- timestamps
- touched file references where available
- generated summaries once available
- decision-like artifacts once available

V1 does not require every future artifact type to exist on day one. The index should tolerate partial enrichment.

## Quality Bar

Users should be able to trust that:

- recent work appears quickly
- project-local search usually finds the right thing
- results explain why they matched (most legible reason, not full scoring breakdown)

If those are not true, search is not ready even if the mechanics work.

## Thin-Slice Release

If we want the smallest meaningful release:

1. Project-first chat search with lexical + structural + temporal ranking
2. Result cards with snippet, recency, and scope context
3. Expand-to-global control
4. Then add richer result types only where they clearly beat raw chat hits:
   - summary / decision hits
   - space / workstream container results
   - file-adjacent results

## V2 Candidates

The obvious V2 work is not "more search" in the abstract. It is making the current retrieval loop feel more precise, more trustworthy, and less chat-only.

### Recommended next bets

If we only pick two follow-ons, they should be:

1. richer result types beyond chats
2. retrieval-to-action flows

Those two directly improve the user outcome from "I found the old chat" to "I found the conclusion and can use it immediately."

### 1. Exact landing anchors

Current V1 navigation carries a soft target (`q` + displayed snippet) and resolves the best matching rendered row client-side. Good enough for V1, but not exact.

V2 should move toward durable anchors such as:

- message or turn IDs in search results
- transcript offsets only if they survive compaction/replay safely
- explicit "open at match" navigation that can highlight the exact source turn

This matters most as result types expand and transcripts grow.

### 2. Preview / peek before navigation

The current interaction is direct navigation. V1 proved that retrieval itself is useful; V2 should reduce context-switch cost.

Desired shape:

- keyboard-first preview in the command menu or side panel
- inspect snippet, context, files, and summary before opening
- explicit actions: Open chat, Open in split, Copy link, Use in handoff

### 3. Better result types beyond raw chats

V1 is effectively chat search. The next quality jump is surfacing the conclusion or container when that is the real thing the user wants.

High-value result types:

- persisted summary / decision hit
- space result when grouped context matters more than one chat
- workstream result once workstreams exist
- file-adjacent result when conversation-to-code navigation is the job

### 4. Stronger ranking and controls

Expected V2 ranking work:

- exact phrase handling and quoted query support
- better weighting of summary hits versus raw transcript hits
- file / branch / space overlap boosts when current context exists
- simple filters or chips only if they materially improve precision

Do not jump to heavy faceting unless real usage shows that ranking alone cannot narrow the set.

### 5. Search quality tooling

If ranking feels wrong, we need first-party debugging rather than guesswork.

Useful additions:

- per-result dev diagnostics for score contributors
- logs for candidate generation vs final ranking
- rebuild / freshness visibility when indexes are behind

### 6. Semantic retrieval only on evidence

Still deferred by default.

Semantic or embedding search becomes justified only if:

- users routinely ask conceptual queries that lexical search misses
- summary / structural ranking fixes are not enough
- we have a clear freshness, rebuild, and privacy story

### 7. Retrieval-to-action flows

Search should become a bridge, not just a locator.

Promising follow-ons:

- send result into a handoff packet
- ask Relay to summarize selected results
- open related chats side-by-side
- jump from search result to touched files or diff context

## Success Signals

- users reach the right chat with fewer navigation steps
- repeat visits start from search instead of sidebar hunting
- qualitative feedback says "I can actually find old discussions now"

## Risks To Watch

- stale indexes after interrupted sessions
- noisy result mixing across projects
- derived result types that overpromise confidence

## Open Questions

- How should result scoring be debugged in logs when ranking feels wrong?
- What is the right preview/peek UX for result cards — inline panel, sidebar, modal?
- Which result types should graduate first in V2: summary/decision hits, spaces, or file-adjacent hits?
- Which action should ship first from search results: split-open, handoff, or synthesize selected results?

## Related Docs

- [Search And Retrieval](./search-and-retrieval.md)
- [Search V1 UX Spec](./search-v1-ux.md)
- [Search V1 Backend Design](./search-v1-backend.md)
- [Themes](../themes.md)
- [Now / Next / Later](../now-next-later.md)
- [Unified Workspace Model RFC](../../unified-workspace-model-rfc.md)
