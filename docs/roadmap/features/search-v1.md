# Search V1 Spec

## Status

Draft

## Goal

Make it reliably easy to recover prior work inside Relay without forcing users to remember which chat, space, or project held the answer.

V1 should feel clearly better than transcript grep, but it does not need to solve the full long-term memory problem.

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

### 3. Re-enter a project

"I have not touched this in two weeks. What should I read first?"

### 4. Find related work artifacts

"Show me the chat, files, and grouped work related to auth cleanup."

## V1 Scope

### In

- Header-invoked search with current-project default scope
- Clear expand-to-global search control
- Search across:
  - chats
  - spaces
  - workstreams once they exist
  - derived summaries or decision-like artifacts once available
- Hybrid ranking using lexical, semantic, recency, and structural signals
- Incremental indexing for changed chats and artifacts

### Out

- Full enterprise-style filters and saved searches
- Cross-user/team search semantics
- Heavy faceting UI
- Perfect answer extraction
- Search-driven automatic memory creation

## Result Types

V1 should support these result types in priority order:

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

### 3. Space or workstream

A container result when the grouped context itself is a better entry point than an individual chat.

### 4. File-adjacent hit

Not a full code search result. This is a "this work touched these files" affordance to help users navigate to the right conversation.

If v1 needs a narrower cut, ship `chat` and `summary / decision hit` first.

## Default UX

### Invocation and scope

- Primary invocation lives in the session header or app-level header
- Search should be available from active chats and spaces without requiring navigation
- Placeholder should suggest both topical and rationale queries
- Search defaults to current project scope
- A visible control allows widening to all Relay projects

### Results list

Each result card should answer:

- what is this?
- why did it match?
- where did it happen?
- where should I jump in?

## Ranking

V1 ranking should blend multiple signals. No single signal is enough.

### Lexical

- keyword match in titles, snippets, summaries, and metadata
- exact phrase match should score strongly

### Semantic

- topic-level similarity for vague queries like "routing decisions"
- should help broaden recall, not dominate ranking

### Structural

- current project boost
- file overlap with current context if available
- branch / space / workstream overlap
- result type weighting, with conclusions above raw containers when confidence is high

### Temporal

- recency matters, but should not bury the clearly correct old result

## Indexing

Search quality depends on freshness. Stale search will lose trust quickly.

V1 direction:

- index incrementally when chats change
- index derived artifacts when summaries or decision-like entries change
- support background rebuild from canonical transcript sources
- treat rebuildability as a core property, not a repair path

Implementation shape is still open, but v1 should bias toward a simple architecture that preserves freshness and debuggability.

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
- vague topical queries are often useful, not random
- results explain why they matched

If those are not true, search is not ready even if the mechanics work.

## Thin-Slice Release

If we want the smallest meaningful release:

1. Project-first chat search with hybrid ranking
2. Result cards with snippet, recency, and scope context
3. Expand-to-global control
4. Summary / decision hits

Then add:

5. Space / workstream container results
6. Project re-entry surfaces built on top of search and summaries

## Success Signals

- users reach the right chat with fewer navigation steps
- repeat visits start from search instead of sidebar hunting
- qualitative feedback says "I can actually find old discussions now"

## Risks To Watch

- semantic ranking that feels arbitrary
- stale indexes after interrupted sessions
- noisy result mixing across projects
- derived result types that overpromise confidence

## Open Questions

- Should semantic indexing happen in-process or in a background worker?
- What is the smallest useful summary / decision artifact for search to consume?
- How should result scoring be debugged in the UI or logs when ranking feels wrong?
- When should project re-entry become a separate feature instead of just using search?

## Related Docs

- [Search And Retrieval](./search-and-retrieval.md)
- [Search V1 UX Spec](./search-v1-ux.md)
- [Search V1 Backend Design](./search-v1-backend.md)
- [Themes](../themes.md)
- [Now / Next / Later](../now-next-later.md)
- [Unified Workspace Model RFC](../../unified-workspace-model-rfc.md)
