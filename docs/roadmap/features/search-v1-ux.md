# Search V1 UX Spec

## Status

Draft

## Goal

Define the user-facing shape of search v1 so implementation can stay aligned on scope, interaction model, and result presentation.

This spec is intentionally about product behavior, not backend indexing details.

## Design Constraints

- Search should feel native to the current Relay project flow, not like a bolted-on separate tool
- The default should be project-scoped
- Search should be invokable from active chats and spaces without making the user navigate elsewhere first
- Results should help users recover context, not just jump to a transcript blob
- The UI should stay lightweight; avoid turning v1 into a filter-heavy search console

## Entry Points

### 1. Header search trigger

Primary entry point.

- Lives in the session header or app-level header
- Available from active chats and spaces without navigation
- Opens a search overlay, sheet, or command-bar style surface
- Placeholder should teach the product shape:
  - `Search this project`
  - Example helper text or rotating examples:
    - `routing decisions`
    - `why did we switch from X`
    - `auth cleanup`

### 2. Global expand action

Visible but secondary.

- Sits next to or inside the scope control
- Label should be explicit:
  - `This project`
  - `All projects`

### 3. Secondary page-level surface

Search may also live on project-level pages like chats, but that should be a secondary surface rather than the main discovery path.

## Primary UX Flow

### Query entered in project scope

1. User types a topical or rationale-oriented query
2. Search opens from the header into an overlay or sheet
3. Results are grouped in one ranked list, not split across tabs in v1
4. Each result explains why it matched
5. User opens the best result and lands in the relevant chat, space, or grouped context

The user should not need to navigate to a dedicated project page before searching.

### No strong result in project scope

1. User sees a clear empty or low-confidence state
2. UI offers `Search all projects`
3. Expanded results preserve the original query and visibly change scope

## Search States

### Idle

Shown before the user types.

- Search input visible
- Optional lightweight suggested queries
- Current scope visible

### Active query

Shown once the user types enough to search.

- Scope control remains visible
- Query should debounce lightly; avoid laggy, over-eager refresh behavior

### Loading

- Keep input interactive
- Show lightweight result skeletons or a compact loading state
- Do not clear the previous results instantly unless the query changed dramatically

### Empty results

- Message should acknowledge the active scope:
  - `No results in this project for "routing decisions"`
- Primary action:
  - `Search all projects`
- Secondary hint:
  - suggest trying a file name, decision phrasing, or broader topic

### Error or index unavailable

- Do not expose backend jargon
- Use a practical message:
  - `Search is not ready yet for this project`
- Action should be retry-oriented, not diagnostic-heavy

## Result List

V1 should use one mixed ranked list.

Why:

- simpler mental model
- better for fuzzy queries
- avoids premature taxonomy decisions

Each row needs to answer four things immediately:

- what is this result?
- why did it match?
- where did it happen?
- what happens if I click it?

## Result Card Anatomy

### Shared structure

- result type label
- primary title
- supporting snippet or summary text
- location metadata
- timestamp
- optional related file chips

### Chat result

- Title: chat name or derived label
- Snippet: matched transcript fragment or summary line
- Metadata: project, space/workstream if relevant, last activity
- Action: open the chat at the relevant point if possible

### Summary / decision result

- Title: conclusion-oriented phrasing, not raw chat title
- Snippet: the rationale or decision summary
- Metadata: source chat or group, recency, provenance hint
- Action: open the source chat or grouped context

### Space / workstream result

- Title: container name
- Snippet: short aggregate summary
- Metadata: project, activity, number of chats if useful
- Action: open the container overview

### File-adjacent result

- Title: file path or file label
- Snippet: "mentioned in 3 chats" or similar context
- Metadata: related project / workstream / chat count
- Action: open the most relevant conversation, not the file itself

## Why It Matched

This should be visible in a lightweight way.

Possible treatments:

- highlighted query terms in snippet
- short reason text like `Matched in summary`
- file chip or scope chip when structural match is relevant

V1 should avoid opaque ranking where users cannot tell why something appeared.

## Scope Control

V1 should use a simple scope toggle, not a full filter panel.

- Default: `This project`
- Secondary: `All projects`

Scope should default to the current project even when search is invoked from a specific chat or space.

Current chat or space context can influence ranking, but should not hard-filter results unless the user explicitly narrows scope later.

When global scope is active:

- show the project name prominently on each result
- maintain the same ranking model, but remove the project-local boost

## Mobile Behavior

V1 mobile should stay narrow and readable.

- search action in the top bar or session header
- search opens as a dedicated sheet or full-screen search view
- scope control as a compact chip or segmented control
- result cards stack vertically
- snippets should truncate aggressively

## Interaction Details

- invoking search from the header should feel global and immediate, not like filtering the current page
- debounce input lightly rather than requiring submit
- preserve query and scope in route state if practical
- keyboard focus should stay in the input during result refresh
- pressing escape should clear the query first, not close the whole page
- clicking a result should feel like navigation, not like opening a modal

## Cut Lines

If scope needs to shrink, cut in this order:

1. File-adjacent result type
2. Rich "why matched" explanations beyond highlighted snippets
3. Suggested queries in idle state
4. Mixed container results beyond chats and summary hits

Do not cut:

- project-first default
- visible scope control
- result snippets

## Open Questions

- Should result clicks deep-link into transcript positions or just open the chat?
- How much route state is worth preserving for back-navigation?
- Should idle search show lightweight suggestions, or just an empty input state?

## Decision Log

- Initial direction: use a command-bar style overlay on desktop and a dedicated full-screen search view on mobile.

## Later

Once search and summaries are working, Relay may add a separate project re-entry surface for "where should I start?" use cases. That should be treated as a follow-on feature, not part of search v1.

## Related Docs

- [Search V1 Spec](./search-v1.md)
- [Search And Retrieval](./search-and-retrieval.md)
- [Themes](../themes.md)
