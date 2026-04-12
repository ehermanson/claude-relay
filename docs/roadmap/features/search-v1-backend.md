# Search V1 Backend Design

## Status

Draft

## Goal

Define a backend architecture for search v1 that is:

- compatible with Relay's existing transcript-first model
- incremental and rebuildable
- simple enough to debug during dogfooding
- good enough to support useful ranking without overcommitting to a permanent search stack too early

## Existing Constraints

- JSONL transcripts remain the canonical source of chat history
- SQLite is already used as Relay's rebuildable metadata/index layer
- `sessions` and `managed_sessions` already persist useful search inputs:
  - project and space identity
  - timestamps
  - summary
  - last message text
  - transcript path
  - branch and workspace metadata
- Relay already supports lightweight path search via [`workspace-entries.ts`](../../../server/core/workspace-entries.ts)

Search v1 should extend this model rather than bypass it.

## Design Principles

### Rebuildable first

The search index should be treated like the session index: useful, persisted, and rebuildable from canonical sources.

### Incremental by default

Recent work must appear quickly without requiring a full rebuild.

### Keep retrieval logic server-side

Ranking and scope decisions should live in the backend so the UI stays thin and consistent across surfaces.

### Hybrid, not embedding-only

Lexical and structural retrieval should work even when semantic indexing is unavailable or still rebuilding.

### Degrade gracefully

If one signal is missing, search should still return something reasonable rather than fail closed.

## V1 Retrieval Model

V1 should use a layered retrieval pipeline:

1. candidate retrieval
2. scoring and ranking
3. result shaping for the UI

This keeps the system understandable and lets us improve individual stages later.

## Searchable Units

### 1. Chat document

Primary unit for v1.

Represents one chat session, external or managed.

Inputs:

- chat identity and title
- summary if present
- first prompt if present
- last message text if present
- selected transcript snippets or extracted text
- project / space / workspace metadata
- timestamps
- touched file references if available later

### Canonical identity rule

Search should index one canonical chat document per logical chat, not one document per persisted row.

V1 should follow the same collapse rule Relay already uses in project and space chat lists:

- prefer the managed representation when both managed and external rows refer to the same logical chat
- treat shared provider session id as a strong duplicate signal
- treat shared transcript path as a strong duplicate signal
- avoid emitting duplicate search documents for managed shadow rows

### 2. Derived summary / decision document

Optional v1.1 layer.

Represents a conclusion-oriented artifact attached to a chat or chat group. This can initially be synthesized from existing summaries rather than requiring a full memory system.

### 3. Container document

Later v1 addition for spaces and workstreams.

Represents grouped context rather than a single chat.

## Storage Strategy

### Canonical sources

- JSONL transcripts on disk
- `sessions`
- `managed_sessions`
- `spaces`
- later: workstream tables and derived summary artifacts

### Search index storage

Prefer a dedicated SQLite-backed search index table set rather than an in-memory-only index.

Why:

- survives restarts
- rebuildable from canonical sources
- easier to inspect during dogfooding
- keeps the search state close to the rest of Relay persistence

V1 should use SQLite FTS for lexical candidate retrieval, backed by normal SQLite tables for metadata and server-side reranking.

Why this is the recommended v1 direction:

- fits Relay's existing persistence model
- avoids inventing a custom lexical search engine
- stays rebuildable and inspectable
- keeps semantic widening optional rather than foundational

## Proposed Index Shape

The exact schema can change, but conceptually v1 needs:

### `search_documents`

One row per searchable unit.

Likely fields:

- `id`
- `kind` (`chat`, later `summary`, `space`, `workstream`)
- `project_id`
- `space_id`
- `instance_id`
- `title`
- `summary`
- `body_text`
- `last_activity_at`
- `created_at`
- `source_updated_at`
- `is_archived`
- `provider`
- `session_id`
- `transcript_path`
- `working_directory`
- `workspace_hint`

### `search_documents_fts`

FTS-backed lexical index over searchable text fields.

Likely indexed text:

- `title`
- `summary`
- `body_text`

### `search_document_files`

Optional mapping of document to touched files once those signals exist.

### `search_document_vectors`

Optional semantic payload storage if v1 includes embeddings.

This should be separable from the base lexical index so the system still works without it.

## Search Document Assembly

V1 should build each `chat` document from the best available persisted state plus bounded transcript-derived text.

### Document fields

Recommended conceptual fields:

- identity:
  - canonical document id
  - `kind`
  - `instance_id`
  - `session_id`
  - `transcript_path`
- ownership:
  - `project_id`
  - `space_id`
  - later `workspace_id`
- display:
  - `title`
  - `summary`
  - `snippet_source`
- retrieval text:
  - `body_text`
  - optional normalized keyword text
- ranking metadata:
  - `created_at`
  - `last_activity_at`
  - `is_archived`
  - `provider`
  - `working_directory`
  - branch / space context when useful

### Title selection

Prefer in this order:

1. explicit chat name / custom title
2. derived persisted name
3. fallback from first prompt if title quality is poor

### Summary selection

Prefer persisted `summary` when available. If absent, v1 can still work without inventing a synthetic summary for every chat.

### Body text selection

`body_text` should be bounded, searchable chat text intended only for retrieval, not for full transcript replay.

Good v1 composition:

- first prompt if present
- last message text if present
- bounded transcript extraction from a few representative user/assistant turns

## Transcript Extraction

V1 should extract only enough transcript text to improve retrieval beyond title and summary matching.

### Goals

- improve lexical recall for topic queries
- support snippet generation
- avoid re-indexing full transcripts on every change
- avoid turning search storage into a second transcript store

### Recommended extraction strategy

Build a bounded transcript excerpt with a stable cap.

Good v1 shape:

- include the first meaningful user turn
- include a few high-signal later turns
- include recent context from the tail of the conversation
- exclude tool noise and repetitive low-signal content where possible

This can be implemented as "head + sparse middle + tail" extraction rather than full replay indexing.

### Size constraints

The exact limits can be tuned, but v1 should enforce:

- per-document `body_text` cap
- truncation strategy that preserves both early intent and recent outcome
- deterministic extraction so rebuilds are stable

### Snippet generation

Search snippets should come from:

1. summary match if available
2. title match
3. extracted `body_text`

This keeps snippet generation cheap and understandable.

## Candidate Retrieval

V1 should retrieve candidates in two passes:

### Pass 1: lexical / structural retrieval

Always available.

Sources:

- title
- summary
- last message text
- selected transcript text
- project / space metadata

This pass should be enough to produce reasonable results even before semantic signals mature.

Recommended implementation:

- query SQLite FTS for lexical candidates
- join candidate ids back to `search_documents`
- apply structural filtering and server-side reranking after retrieval

### Pass 2: semantic widening

Optional but desirable for vague topical queries.

Use only to broaden recall among plausible candidates, not to replace lexical retrieval entirely.

Good fallback rule:

- no semantic index: lexical search still works
- partial semantic index: merge semantic results only where available

## Ranking

Ranking should happen in the server after candidate retrieval.

Inputs:

- lexical score
- semantic score if available
- current project boost
- current space / chat context boost
- recency
- result kind weighting
- archival penalty

Important rule:

Current chat or space context should boost ranking, not hard-filter results.

FTS ranking should be treated as one input signal, not the final ordering.

## Freshness Model

### Incremental updates

Update affected search documents when:

- a chat summary changes
- the last message changes
- transcript replay or scan produces new searchable content
- project / space membership changes

Updates do not need to rebuild the entire transcript excerpt every time if only metadata changed.

### Full rebuild

Support full rebuild from persisted session rows and transcript sources:

- on schema/version mismatch
- on explicit admin/debug action
- as a recovery path after interrupted indexing

Rebuild should be safe and deterministic.

## Indexing Hooks

V1 should attach search updates to the same lifecycle points where Relay already learns that chat state changed.

The goal is to keep search fresh without reprocessing transcripts on every generic persistence event.

### Update modes

V1 should split indexing into two update modes:

#### 1. Metadata update

Cheap update that rewrites the search document from existing persisted or live metadata only.

Use when:

- title changes
- summary changes
- last message metadata changes
- project or space ownership changes
- archival state changes

This path should not reread or re-extract transcript text unless required.

#### 2. Content update

More expensive update that recomputes bounded transcript-derived `body_text` and refreshes the FTS-backed text fields.

Use when:

- transcript replay has advanced
- watcher-driven transcript content changed materially
- startup scan discovered or refreshed historical chats
- full rebuild is running

### Recommended hook points

#### `dbSave(instance)`

Use as the main metadata hook.

Why:

- central persistence point for live state
- already runs after ownership reconciliation and persistence shaping
- sees title, last message, provider metadata, project id, and space id changes

Recommended search action:

- `upsertChatMetadata(...)`

#### Transcript watcher / replay completion

Use as the main content hook.

Why:

- this is when searchable transcript-derived content actually changes
- avoids redoing transcript extraction on every generic save

Recommended search action:

- `upsertChatContent(...)`

This should be debounced or coalesced so active chats do not trigger excessive reindexing.

#### Startup historical scan / restore paths

Use as the historical backfill hook.

Why:

- search must work for inactive historical chats, not only live instances
- rebuildable historical indexing is part of the product promise

Recommended search action:

- `rebuildProject(...)` or `rebuildAll()`
- or batched `upsertChatContent(...)` during scan if that is simpler

#### Summary backfill or summary updates

Use as a metadata-first hook.

Why:

- summaries are one of the highest-value search signals
- summary freshness matters more than transcript completeness for many queries

Recommended search action:

- `upsertChatMetadata(...)`
- optionally `upsertChatContent(...)` if summary text is mirrored into FTS fields through the same write path

### Hooking rules

- do not index directly off token-stream events
- do not make the UI responsible for triggering freshness
- do not rely only on in-memory instances; historical persisted chats must be searchable
- prefer batched or queued updates when many transcript changes arrive at once

## Suggested Service Shape

V1 should keep indexing logic in a dedicated server/core service rather than scattering it across persistence call sites.

Conceptually:

- `upsertChatMetadata(identity)`
- `upsertChatContent(identity)`
- `rebuildProject(projectId)`
- `rebuildAll()`

`InstanceManager` should call into this service from existing lifecycle hooks.

This keeps search logic server-side and makes the indexing path easier to inspect and test.

## Indexing Pipeline

V1 pipeline should look like:

1. identify changed chat or artifact
2. resolve canonical chat identity and collapse duplicates
3. assemble normalized search document input
4. write or replace the search document row
5. update optional semantic payload if enabled

This should be driven off the server's existing lifecycle points rather than a separate distributed job model.

## Where Indexing Runs

V1 recommendation:

- keep indexing in the main server process
- do small incremental updates inline or on a lightweight queue
- reserve background workers for later only if latency or reliability demands it

Why:

- simpler debugging
- fewer moving parts while dogfooding
- easier consistency with current persistence flows

If semantic indexing becomes expensive, that piece can later move to a background worker without rewriting the lexical path.

## Transcript Handling

V1 should not try to index entire transcripts naively on every change.

Instead:

- use existing persisted summary and last-message fields immediately
- add bounded transcript extraction for search text
- keep extracted body text capped to avoid unbounded index growth

This is enough for useful retrieval without turning the index into a second transcript store.

## Duplicate Collapse

V1 needs an explicit collapse rule so search results do not duplicate the same chat through both managed and external persistence paths.

### Preferred canonical source

When multiple persisted representations refer to the same logical chat:

- prefer the live in-memory instance when present for freshness
- otherwise prefer the managed row
- otherwise use the external session row

### Duplicate signals

Treat these as strong signals that two persisted rows represent the same logical chat:

- same provider session id
- same transcript path

These are already the signals Relay uses when collapsing project and space chat lists, so search should match that behavior.

### Document id strategy

The document id should be stable across incremental updates and rebuilds.

V1 recommendation:

- derive the canonical id from the managed `instance_id` when present
- otherwise fall back to the external `instance_id`
- do not emit both once duplicate collapse has resolved a winner

## API Shape

V1 likely needs a dedicated server-side search API rather than piggybacking on list endpoints.

Conceptually:

- `GET /api/search?q=...&projectId=...`
- optional scope mode for current project vs all projects
- optional current context hints:
  - `currentInstanceId`
  - `currentSpaceId`

Response should return already-ranked, already-shaped results for the UI.

## Result Shaping

The backend should produce UI-ready search results:

- result kind
- stable target id
- title
- snippet
- why-matched hints
- project / space metadata
- timestamps

That avoids duplicating result assembly logic across header search, page-level search, and future mobile surfaces.

## Compatibility Notes

This design should remain compatible with:

- the unified workspace direction
- future workstreams
- future project memory / decision artifacts

Search documents should attach to canonical IDs where possible:

- `project_id`
- `space_id`
- later `workspace_id` if that becomes canonical underneath spaces

## Recommended Thin Slice

Implement in this order:

1. dedicated search API
2. `chat` search documents backed by existing session metadata
3. SQLite FTS candidate retrieval over `title`, `summary`, and bounded `body_text`
4. bounded transcript text extraction
5. server-side reranking with scope, recency, and result-kind boosts
6. optional semantic widening
7. later document kinds for summaries, spaces, and workstreams

## Risks

- indexing too much transcript text and making rebuilds slow
- tying search too tightly to ephemeral in-memory state
- semantic scoring that is expensive but not clearly better
- duplicate or shadow results across managed and external session representations

## Open Questions

- What is the right bounded transcript extraction strategy for v1?
- Should snippet generation be stored with the document or derived at query time from the indexed fields?

## Decision Log

- Initial direction: use SQLite FTS for lexical candidate retrieval, then rerank in server code using structural and temporal signals.

## Related Docs

- [Search V1 Spec](./search-v1.md)
- [Search V1 UX Spec](./search-v1-ux.md)
- [Search And Retrieval](./search-and-retrieval.md)
- [Project Memory](./project-memory.md)
- [Unified Workspace Model RFC](../../unified-workspace-model-rfc.md)
