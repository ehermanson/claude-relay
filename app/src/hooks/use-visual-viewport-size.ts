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
 * visualViewport.height and this is a no-op — CSS `height: 100%` stays in
 * charge.
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
      // visual viewport, the focused composer is visible without it.
      if (keyboardInset > 1 && (window.scrollY > 0 || vv.offsetTop > 0)) {
        window.scrollTo(0, 0);
      }
    };

    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
      document.body.style.height = "";
    };
  }, []);
}
