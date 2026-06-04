import { useState, useEffect } from "react";

/**
 * Returns true only after `pending` has been continuously true for at least `delay` ms.
 * Prevents spinner flicker for fast async operations — the visual indicator only appears
 * if the work is actually taking long enough for the user to perceive it.
 */
export function useDelayedPending(pending: boolean, delay = 200): boolean {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!pending) {
      setShow(false);
      return;
    }
    const id = setTimeout(() => setShow(true), delay);
    return () => clearTimeout(id);
  }, [pending, delay]);

  return show;
}
