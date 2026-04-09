import { useEffect, useState } from "react";

/**
 * Returns `true` during the first render of the component, then re-renders
 * once after the first paint with `false`. Useful for suppressing CSS
 * transitions and motion animations on initial mount so the layout snaps
 * to its state instead of animating from a neutral default.
 *
 * Combine with `key={someId}` on the component (or an ancestor) to also
 * suppress animations when navigating between ids.
 *
 * Implementation note: uses `requestAnimationFrame` so the flip happens
 * after the browser paints the first render. This guarantees the
 * "transition class added" re-render is a no-op (no other props change
 * simultaneously), so the next user-initiated change animates correctly.
 */
export function useFirstPaint(): boolean {
  const [first, setFirst] = useState(true);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setFirst(false));
    return () => cancelAnimationFrame(raf);
  }, []);
  return first;
}
