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
 * Known wart, accepted: iOS freezes web-content compositing while the
 * keyboard presentation transition runs, so the shrunk layout — although
 * committed within milliseconds of focus — is *painted* only once the
 * transition settles (~0.5–1s perceived stall). There is no web-platform
 * escape hatch: pre-shrinking at pointerdown paints in time but moves the
 * tap target mid-gesture, which makes iOS abandon the tap entirely (no
 * focus, no keyboard). Do not "fix" this by reacting to visualViewport
 * changes with transforms/scroll corrections — see the history of this file.
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

    const setBodyHeight = (px: number | null) => {
      document.body.style.height = px === null ? "" : `${px}px`;
    };

    // Sync to the *actual* visual viewport — runs on every vv geometry event.
    const apply = () => {
      const inset = window.innerHeight - vv.height;
      const keyboardOpen = inset > 1;
      setBodyHeight(keyboardOpen ? vv.height : null);
      if (keyboardOpen) writeCachedInset(inset);
      // Residual document-level push (rare once the anticipated sizing is in
      // effect) can be cancelled directly. Must be "instant" — html has
      // scroll-behavior:smooth, which would animate the correction.
      if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: "instant" });
    };

    // Anticipate the keyboard: shrink the shell before it opens so WebKit
    // never needs to push the page.
    const onFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest?.(FOCUSABLE)) return;
      const cached = readCachedInset();
      if (cached > 50 && window.innerHeight - vv.height <= 1) {
        setBodyHeight(window.innerHeight - cached);
      }
      // If no keyboard actually appears (hardware keyboard, iPad), undo —
      // apply() sees inset ≈ 0 and restores CSS sizing.
      clearTimeout(verifyTimer);
      verifyTimer = setTimeout(apply, 700);
    };

    const onFocusOut = (e: FocusEvent) => {
      clearTimeout(verifyTimer);
      // Focus moving between inputs keeps the keyboard up — don't flicker.
      if ((e.relatedTarget as Element | null)?.closest?.(FOCUSABLE)) return;
      // Restore immediately on blur — the keyboard is on its way down and
      // waiting for its geometry event leaves the shell squished with dead
      // space below. A trailing apply() re-syncs to whatever really happened.
      setBodyHeight(null);
      verifyTimer = setTimeout(apply, 250);
    };

    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    window.addEventListener("scroll", apply, { passive: true });
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
      window.removeEventListener("scroll", apply);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      clearTimeout(verifyTimer);
      setBodyHeight(null);
    };
  }, []);
}
