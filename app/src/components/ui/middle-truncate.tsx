/**
 * MiddleTruncate — Truncates the middle of a string so the beginning and end
 * remain visible. Uses @chenglou/pretext for accurate text measurement.
 */

import { memo, useCallback, useLayoutEffect, useRef, useState } from "react";
import { prepare, layout } from "@chenglou/pretext";

const ELLIPSIS = "…";

/** Font string matching the file list UI (0.8125rem ≈ 13px Outfit). */
const FILE_LIST_FONT = '13px "Outfit", system-ui, sans-serif';
const LINE_HEIGHT = 20; // approximate, only need lineCount === 1 check

/**
 * Returns the middle-truncated string that fits within `maxWidth` pixels,
 * preserving the beginning and end of the text.
 */
function middleTruncate(text: string, maxWidth: number, font: string): string {
  // Check if full text fits
  const full = prepare(text, font);
  if (layout(full, maxWidth, LINE_HEIGHT).lineCount <= 1) {
    return text;
  }

  // Binary search: find max chars we can keep (biased toward the end
  // so filenames stay readable — ~30% start, ~70% end)
  let lo = 1;
  let hi = text.length - 1;

  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    const startLen = Math.max(1, Math.round(mid * 0.3));
    const endLen = mid - startLen;
    const candidate = text.slice(0, startLen) + ELLIPSIS + text.slice(text.length - endLen);
    const p = prepare(candidate, font);
    if (layout(p, maxWidth, LINE_HEIGHT).lineCount <= 1) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }

  const startLen = Math.max(1, Math.round(lo * 0.3));
  const endLen = lo - startLen;
  if (endLen === 0) {
    return text.slice(0, startLen) + ELLIPSIS;
  }
  return text.slice(0, startLen) + ELLIPSIS + text.slice(text.length - endLen);
}

export const MiddleTruncate = memo(function MiddleTruncate({
  text,
  font = FILE_LIST_FONT,
  className,
}: {
  text: string;
  font?: string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = useState(text);
  const textRef = useRef(text);
  textRef.current = text;
  const fontRef = useRef(font);
  fontRef.current = font;

  const recompute = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // Use the element's available width
    const width = el.clientWidth;
    if (width > 0) {
      setDisplay(middleTruncate(textRef.current, width, fontRef.current));
    }
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    recompute();

    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [recompute, text, font]);

  return (
    <span
      ref={ref}
      className={className}
      style={{ display: "block", overflow: "hidden", whiteSpace: "nowrap" }}
    >
      {display}
    </span>
  );
});
