# Operational Awareness

## Problem

Long-lived sessions, stale local state, and overlapping work can create confusion that is hard to diagnose from the current UI.

## Why This Matters

Trust in Relay depends on users understanding what is active, stale, resumable, or drifting.

## User Outcomes

- Spot stale or interrupted work quickly
- Understand when two chats may be overlapping or conflicting
- Know when a summary or memory might be outdated

## Non-Goals

- Heavy project management dashboards
- False precision about agent state when confidence is low

## Proposed UX

- Simple stale-session badges can ship ahead of the broader awareness system
- Session health indicators
- "Possibly stale" warnings on summaries and memories
- Overlap/conflict hints for active chats with similar file or branch scope
- Resume diagnostics when a session is broken or partial

## Key Risks

- Too many warnings become noise
- Low-confidence heuristics could undermine trust

## Dependencies

- Better state inspection and confidence scoring
- Metadata on touched files, branches, and summary freshness

## Open Questions

- Which warnings are important enough for the primary UI?
- How should Relay explain uncertainty without sounding vague?
- What state can be computed cheaply in real time?

## Related Docs

- [Themes](../themes.md)
- [Now / Next / Later](../now-next-later.md)
- [Search And Retrieval](./search-and-retrieval.md)
- [Project Memory](./project-memory.md)

## Decision Log

- Initial direction: operational awareness should improve trust and recovery, not become a monitoring product.
- Initial direction: ship cheap stale-state indicators early if they are high-signal and low-noise.
