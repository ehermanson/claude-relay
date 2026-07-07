import { useEffect } from "react";

/**
 * Keep the app shell inside the *visual* viewport when the on-screen keyboard
 * is up.
 *
 * iOS doesn't shrink the layout viewport for the keyboard — it shrinks the
 * visual viewport and pushes the page (via visualViewport.offsetTop AND
 * window scroll, animated alongside the keyboard) to keep the focused input
 * visible, shoving the whole shell (header included) off-screen above.
 *
 * Reactively countering the push after it starts is a losing game: cancelling
 * it fights an animation, and following it with a transform moves the focused
 * input, which re-triggers WebKit's reveal — a jitter feedback loop.
 *
 * Strategy: make the push unnecessary. On focusin we shrink <body> to the
 * *anticipated* visual viewport height using the keyboard inset cached from
 * the last keyboard appearance (persisted in localStorage). The focused
 * composer is then already above where the keyboard will land, so WebKit has
 * nothing to reveal and never pushes. When the keyboard actually reports its
 * geometry (visualViewport resize) we correct to the exact height and refresh
 * the cache. The very first focus on a device (no cache yet) still gets the
 * legacy push-then-settle; every focus after that is clean.
 *
 * On platforms where the layout viewport already resizes with the keyboard
 * (interactive-widget=resizes-content, Android), innerHeight tracks
 * visualViewport.height and this is a no-op — CSS `height: 100%` stays in
 * charge.
 */

const KB_INSET_CACHE_KEY = "relay-keyboard-inset";
const FOCUSABLE = 'input, textarea, [contenteditable="true"], [contenteditable=""]';

function readCachedInset(): number {
  try {
    const v = Number(window.localStorage.getItem(KB_INSET_CACHE_KEY));
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}

function writeCachedInset(inset: number) {
  try {
    window.localStorage.setItem(KB_INSET_CACHE_KEY, String(Math.round(inset)));
  } catch {
    // Private mode etc. — first-focus push just stays un-anticipated.
  }
}

export function useVisualViewportSize() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    let verifyTimer: ReturnType<typeof setTimeout> | undefined;
    // Diagnostic maxima — survive the settle so a screenshot after the fact
    // still shows which mechanism WebKit used. Reset when the keyboard closes.
    let maxOffset = 0;
    let maxScrollY = 0;

    const setBodyHeight = (px: number | null) => {
      document.body.style.height = px === null ? "" : `${px}px`;
    };

    // Sync to the *actual* visual viewport — runs on every vv geometry event.
    const apply = (src: string) => {
      const inset = window.innerHeight - vv.height;
      const keyboardOpen = inset > 1;
      if (!keyboardOpen) {
        maxOffset = 0;
        maxScrollY = 0;
      }
      maxOffset = Math.max(maxOffset, vv.offsetTop);
      maxScrollY = Math.max(maxScrollY, window.scrollY);

      setBodyHeight(keyboardOpen ? vv.height : null);
      if (keyboardOpen) writeCachedInset(inset);
      // Residual document-level push (should be rare once the anticipated
      // sizing is in effect) can be cancelled directly. Must be "instant" —
      // html has scroll-behavior:smooth, which would animate the correction.
      if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: "instant" });

      logEvent(
        `${src} vvh=${Math.round(vv.height)} off=${Math.round(vv.offsetTop)} ` +
          `sy=${Math.round(window.scrollY)}`,
      );
      updateDebugReadout(vv, inset, maxOffset, maxScrollY);
    };

    // Anticipate the keyboard: shrink the shell before it opens so WebKit
    // never needs to push the page.
    const onFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest?.(FOCUSABLE)) return;
      const cached = readCachedInset();
      const preShrink = cached > 50 && window.innerHeight - vv.height <= 1;
      if (preShrink) setBodyHeight(window.innerHeight - cached);
      logEvent(`focusin cache=${cached} pre=${preShrink ? "y" : "n"}`);
      updateDebugReadout(vv, window.innerHeight - vv.height, maxOffset, maxScrollY, true);
      // If no keyboard actually appears (hardware keyboard, iPad), undo —
      // apply() sees inset ≈ 0 and restores CSS sizing.
      clearTimeout(verifyTimer);
      verifyTimer = setTimeout(() => apply("verify-timer"), 700);
    };

    const onFocusOut = () => {
      // Let the vv resize handle restoration; this is a fallback for cases
      // where the blur doesn't produce a geometry event.
      clearTimeout(verifyTimer);
      verifyTimer = setTimeout(() => apply("focusout-timer"), 250);
    };

    const onVvResize = () => apply("vv-resize");
    const onVvScroll = () => apply("vv-scroll");
    const onWinScroll = () => apply("win-scroll");

    apply("init");
    vv.addEventListener("resize", onVvResize);
    vv.addEventListener("scroll", onVvScroll);
    window.addEventListener("scroll", onWinScroll, { passive: true });
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      vv.removeEventListener("resize", onVvResize);
      vv.removeEventListener("scroll", onVvScroll);
      window.removeEventListener("scroll", onWinScroll);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      clearTimeout(verifyTimer);
      setBodyHeight(null);
      removeDebugReadout();
    };
  }, []);
}

// ── Temporary diagnostic ──────────────────────────────────────────────
// TODO(remove): on-device readout for debugging the iOS keyboard push.
// Top-right, visible while the keyboard is up or a push is detected. Shows
// live geometry plus a timestamped trace of the last handful of events
// (+ms since the burst started) so a screenshot reveals event ordering.
let debugEl: HTMLDivElement | null = null;

const eventLog: string[] = [];
let burstStart = 0;
let lastEventKey = "";
let lastEventCount = 0;

function logEvent(entry: string) {
  const now = performance.now();
  // New burst after 3s of quiet — keeps the trace scoped to one interaction.
  if (eventLog.length === 0 || now - burstStart > 3000) {
    eventLog.length = 0;
    burstStart = now;
    lastEventKey = "";
  }
  const src = entry.split(" ")[0];
  if (src === lastEventKey) {
    // Collapse consecutive same-source events (vv-scroll storms) into one
    // line with a counter, updating the payload and timestamp.
    lastEventCount += 1;
    eventLog[eventLog.length - 1] = `+${Math.round(now - burstStart)} ${entry} x${lastEventCount}`;
    return;
  }
  lastEventKey = src;
  lastEventCount = 1;
  eventLog.push(`+${Math.round(now - burstStart)} ${entry}`);
  if (eventLog.length > 8) eventLog.shift();
}

function updateDebugReadout(
  vv: VisualViewport,
  keyboardInset: number,
  maxOffset: number,
  maxScrollY: number,
  force = false,
) {
  const pushed = vv.offsetTop > 1 || window.scrollY > 1;
  const show = force || keyboardInset > 1 || pushed;
  if (!show) {
    removeDebugReadout();
    return;
  }
  if (!debugEl) {
    debugEl = document.createElement("div");
    debugEl.style.cssText =
      "position:fixed;right:8px;top:calc(env(safe-area-inset-top,0px) + 8px);" +
      "z-index:99999;pointer-events:none;" +
      "font:10px/1.4 monospace;color:#4ade80;background:rgba(0,0,0,0.75);" +
      "padding:4px 6px;border-radius:6px;white-space:pre;";
    document.body.appendChild(debugEl);
  }
  debugEl.textContent =
    `ih:${Math.round(window.innerHeight)} vvh:${Math.round(vv.height)}\n` +
    `off:${Math.round(vv.offsetTop)} (max ${Math.round(maxOffset)})\n` +
    `sy:${Math.round(window.scrollY)} (max ${Math.round(maxScrollY)})\n` +
    `bodyH:${document.body.style.height || "css"}\n` +
    `── trace ──\n${eventLog.join("\n")}`;
}

function removeDebugReadout() {
  debugEl?.remove();
  debugEl = null;
}
