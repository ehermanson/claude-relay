# Provider Feature Strategy

Relay rides on top of Claude Code and Codex. Both teams ship fast. We can't and
shouldn't match them feature-for-feature. This doc defines what we adopt and what
we deliberately skip, so triage decisions are near-automatic.

## What Relay actually is

Not a moat — a unifying layer. Providers ship remote access, multi-session, and
branch/worktree workflows themselves; we don't out-feature them on their own turf.
The one genuinely differentiated capability is **multi-provider**: Claude and Codex
under one consistent surface. Everything else we do, we do _uniformly across providers_ —
coherence is the product, not exclusivity.

## What we chase

- **Cross-provider normalization**: when one provider ships something the other already
  has (or will), make it work the same way through `ProviderCapabilities`. A feature that
  exists in both CLIs but behaves inconsistently in Relay is a bug in our value prop.
- **Multi-provider features**: anything that only makes sense because Relay runs multiple
  providers at once. This is the one place no single provider team is incentivized to go.
- **Capability-shaped additions**: a new reasoning level, runtime mode, model option, or
  session arg — maps onto `ProviderCapabilities` + a UI control rendered from metadata.
  Cheap, on-strategy, adopt by default.
- **New primitives we can generalize**: a provider concept that fits >1 provider (plan
  review, rate-limit windows) → build the shared abstraction.

## What we DON'T chase

- **Single-provider inner-loop UX** the CLI already does well inside its own session,
  with no cross-provider analog (custom diff viewers, in-CLI theming).
- **Features adopted just because a provider shipped them** — the test is "does this make
  the unified, cross-provider surface more coherent or more capable," not "do they have it."
- **Anything we get for free** through SDK/transcript passthrough.

## The triage buckets

0. **Breaking / deprecation** — an SDK or app-server change that alters or removes something
   Relay's contract depends on (renamed/removed method, changed message shape, deprecated
   arg, bumped min version). ALWAYS file, priority 1, tag `bucket-0`. Highest-value output;
   surface at the top of the summary. The experimental `get_usage` method is the canonical
   example of an API flagged to change. Note: our SDK deps are pinned, so an upstream
   breaking change is a heads-up for our next upgrade, not an already-broken state.
1. **Free** — flows through automatically. No task. One-line note.
2. **Capability-declaration** — flag in `ProviderCapabilities` + UI control. File a task,
   pre-scoped, near-mechanical.
3. **New surface** — needs design. File a task only if it passes the "what we chase" test
   above; otherwise note as "skipped, out of lane" with a one-line reason.

## Standing signal to watch for

When a change is bucket-3 _only because Relay lacks a generalization_, flag it explicitly:
"would have been bucket-2 if we had abstraction X." That's the highest-value feature signal.
