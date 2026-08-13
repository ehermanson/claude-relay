import { useState } from "react";
import { Folder } from "lucide-react";

/**
 * A project's scanned favicon.
 *
 * Falls back to the project's initial rather than a folder glyph when there's
 * no icon — in a column of avatars every folder looks identical, which defeats
 * the point of keying rows by project. Callers without a name still get the
 * folder.
 */
export function ProjectAvatar({
  iconPath,
  name,
  size = 13,
  className = "",
  fallbackClassName = "text-muted",
}: {
  iconPath?: string;
  /** Project name — its first character is the icon-less fallback. */
  name?: string;
  size?: number;
  className?: string;
  /** Classes for the folder fallback only — keeps its color off the <img>. */
  fallbackClassName?: string;
}) {
  const [imgError, setImgError] = useState(false);

  if (!iconPath || imgError) {
    const initial = name?.trim().charAt(0).toUpperCase();
    if (!initial) {
      return <Folder size={size} strokeWidth={2} className={`shrink-0 ${fallbackClassName}`} />;
    }
    return (
      <span
        aria-hidden
        style={{ width: size, height: size, fontSize: Math.max(7, Math.round(size * 0.58)) }}
        className={`flex shrink-0 items-center justify-center rounded-sm bg-surface-hover font-extrabold uppercase leading-none text-text-bright/80 ${className}`}
      >
        {initial}
      </span>
    );
  }

  return (
    <img
      src={`/api/file?path=${encodeURIComponent(iconPath)}`}
      alt=""
      width={size}
      height={size}
      style={{ width: size, height: size }}
      onError={() => setImgError(true)}
      className={`shrink-0 rounded-sm object-contain ${className}`}
    />
  );
}
