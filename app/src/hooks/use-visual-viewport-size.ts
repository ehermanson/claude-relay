import { useEffect } from "react";

/**
 * Keep the app shell inside the *visual* viewport when the on-screen keyboard
 * is up.
 *
 * iOS doesn't shrink the layout viewport for the keyboard — it shrinks the
 * visual viewport and scrolls the page to keep the focused input visible,
 * shoving the whole shell (header included) off-screen above. Anything pinned
 * to the top of a scroll container (e.g. message framing) lands in that
 * cropped zone. Sizing <body> to the visual viewport and cancelling the page
 * push keeps the shell fully visible, so in-app scroll math stays correct.
 *
 * On platforms where the layout viewport already resizes with the keyboard
 * (interactive-widget=resizes-content, Android), innerHeight tracks
 * visualViewport.height and the sizing is a no-op — CSS `height: 100%` stays
 * in charge.
 */
export function useVisualViewportSize() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const apply = () => {
      const keyboardInset = window.innerHeight - vv.height;
      // Only take over sizing when the visual viewport is actually smaller
      // than the layout viewport (keyboard up on a non-resizing platform).
      document.body.style.height = keyboardInset > 1 ? `${vv.height}px` : "";
      // Cancel WebKit's focus-reveal page push — with the shell shrunk to the
      // visual viewport, the focused composer is visible without it. Checked
      // independently of the inset: some standalone-mode iOS versions resize
      // innerHeight AND still push the page.
      if (window.scrollY > 0 || vv.offsetTop > 0) {
        window.scrollTo(0, 0);
      }
      updateDebugReadout(vv, keyboardInset);
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
      removeDebugReadout();
    };
  }, []);
}

// ── Temporary diagnostic ──────────────────────────────────────────────
// TODO(remove): on-device readout for debugging the iOS keyboard push.
// Appears (bottom-right, green mono text) only while the keyboard is up or a
// page push is detected — if the shell still slides off-screen, the numbers
// tell us which mechanism WebKit used (vv offset vs window scroll vs neither).
let debugEl: HTMLDivElement | null = null;

function updateDebugReadout(vv: VisualViewport, keyboardInset: number) {
  const pushed = vv.offsetTop > 1 || window.scrollY > 1;
  const show = keyboardInset > 1 || pushed;
  if (!show) {
    removeDebugReadout();
    return;
  }
  if (!debugEl) {
    debugEl = document.createElement("div");
    debugEl.style.cssText =
      "position:fixed;right:8px;bottom:8px;z-index:99999;pointer-events:none;" +
      "font:10px/1.4 monospace;color:#4ade80;background:rgba(0,0,0,0.75);" +
      "padding:4px 6px;border-radius:6px;white-space:pre;";
    document.body.appendChild(debugEl);
  }
  debugEl.textContent =
    `ih:${Math.round(window.innerHeight)} vvh:${Math.round(vv.height)}\n` +
    `off:${Math.round(vv.offsetTop)} sy:${Math.round(window.scrollY)}\n` +
    `bodyH:${document.body.style.height || "css"}`;
}

function removeDebugReadout() {
  debugEl?.remove();
  debugEl = null;
}
