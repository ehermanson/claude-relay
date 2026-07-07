import { useEffect } from "react";

/**
 * Keep the app shell inside the *visual* viewport when the on-screen keyboard
 * is up.
 *
 * iOS doesn't shrink the layout viewport for the keyboard — it shrinks the
 * visual viewport and pushes the page (animated, alongside the keyboard) to
 * keep the focused input visible, shoving the whole shell (header included)
 * off-screen above. Anything pinned to the top of a scroll container (e.g.
 * message framing) lands in that cropped zone.
 *
 * Strategy: size <body> to the visual viewport, and *follow* the push with a
 * translateY(visualViewport.offsetTop) instead of trying to cancel it —
 * scrollTo(0,0) can't undo an offset-based push instantly, and fighting it
 * produces a slide-up-then-slow-settle mess. Following the offset keeps the
 * shell visually pinned inside the visible area during the keyboard animation
 * and whatever settle iOS does afterwards.
 *
 * On platforms where the layout viewport already resizes with the keyboard
 * (interactive-widget=resizes-content, Android), innerHeight tracks
 * visualViewport.height and this is a no-op — CSS `height: 100%` stays in
 * charge.
 */
export function useVisualViewportSize() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    // Diagnostic maxima — survive the settle so a screenshot after the fact
    // still shows which mechanism WebKit used. Reset when the keyboard closes.
    let maxOffset = 0;
    let maxScrollY = 0;

    const apply = () => {
      const keyboardInset = window.innerHeight - vv.height;
      const keyboardOpen = keyboardInset > 1;
      if (!keyboardOpen) {
        maxOffset = 0;
        maxScrollY = 0;
      }
      maxOffset = Math.max(maxOffset, vv.offsetTop);
      maxScrollY = Math.max(maxScrollY, window.scrollY);

      document.body.style.height = keyboardOpen ? `${vv.height}px` : "";
      // Pin the shell to the visual viewport: translate by the push offset so
      // the shell rides along instead of being cropped. Transform on <body>
      // also re-anchors position:fixed descendants to the shell, which is
      // what we want while the keyboard is up.
      document.body.style.transform =
        keyboardOpen && vv.offsetTop > 0 ? `translateY(${vv.offsetTop}px)` : "";
      // Document-level scroll (the other push mechanism) can be cancelled
      // directly.
      if (window.scrollY > 0) window.scrollTo(0, 0);

      updateDebugReadout(vv, keyboardInset, maxOffset, maxScrollY);
    };

    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    window.addEventListener("scroll", apply, { passive: true });
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
      window.removeEventListener("scroll", apply);
      document.body.style.height = "";
      document.body.style.transform = "";
      removeDebugReadout();
    };
  }, []);
}

// ── Temporary diagnostic ──────────────────────────────────────────────
// TODO(remove): on-device readout for debugging the iOS keyboard push.
// Top-right (the bottom of the layout viewport hides behind the keyboard),
// visible only while the keyboard is up or a push is detected. `off`/`sy`
// show current (max-seen) values since the keyboard opened.
let debugEl: HTMLDivElement | null = null;

function updateDebugReadout(
  vv: VisualViewport,
  keyboardInset: number,
  maxOffset: number,
  maxScrollY: number,
) {
  const pushed = vv.offsetTop > 1 || window.scrollY > 1;
  const show = keyboardInset > 1 || pushed;
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
    `bodyH:${document.body.style.height || "css"}`;
}

function removeDebugReadout() {
  debugEl?.remove();
  debugEl = null;
}
