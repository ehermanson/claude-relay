# Mobile Companion

## Problem

Relay is reachable from phones today, but the current experience is still shaped like the desktop web app.

## Why This Matters

There is value in ambient access to sessions and project state, but a phone should not try to be the full control surface.

## User Outcomes

- Check progress away from a desk
- Search and read past work
- Send quick replies or approvals
- Resume the right chat from anywhere

## Non-Goals

- Full desktop parity on mobile
- Advanced repo or terminal management from a phone

## Proposed UX

- Start with better responsive web before committing to native
- Search, inbox-like activity, and lightweight chat views
- Quick approval and reply flows
- Notifications for approvals, completions, and other time-sensitive events
- Strong project and workstream overview surfaces
- A cleaner remote-connection story around the same Relay server

## Key Risks

- Building native too early before the product surface is clear
- Spending effort on mobile shells before desktop continuity features are strong

## Dependencies

- Better search, summaries, and handoff views
- A more explicit server/client split for remote access

## Open Questions

- Should this begin as improved responsive web, a native wrapper, or a true native app?
- What are the minimal mobile-first jobs Relay should support well?
- How should notifications and approvals fit the trust model?

## Related Docs

- [Themes](../themes.md)
- [Now / Next / Later](../now-next-later.md)
- [Handoff](./handoff.md)
- [Cross-Chat Synthesis](./cross-chat-synthesis.md)
- [Operational Awareness](./operational-awareness.md)

## Decision Log

- Initial direction: mobile should be a focused companion, not a full clone of the desktop app.
