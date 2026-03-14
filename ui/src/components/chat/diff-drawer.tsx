import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PatchDiff } from "@pierre/diffs/react";
import { ChevronRight, X } from "lucide-react";
import { useTheme } from "../../context/theme-context";
import { fetchInstanceDiff } from "../../lib/api";
import { Spinner } from "../ui/spinner";
import { Button } from "../ui/button";
import { FileIcon } from "../ui/file-icon";
import type { FileChange } from "@shared/types";

/** Files that are noisy / auto-generated — collapsed by default. */
const GENERATED_PATTERNS = [
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  /\.lock$/,
  /issues\.jsonl$/,
  /\.beads\//,
];

function isGenerated(path: string): boolean {
  return GENERATED_PATTERNS.some((re) => re.test(path));
}

interface FilePatch {
  path: string;
  patch: string;
  additions: number;
  deletions: number;
}

/** Split a multi-file unified diff into per-file patch strings. */
function splitPatch(patch: string): FilePatch[] {
  const files: FilePatch[] = [];
  const parts = patch.split(/^(?=diff --git )/m);
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const headerMatch = trimmed.match(/^diff --git a\/(.+?) b\//);
    const path = headerMatch?.[1] ?? "unknown";
    let additions = 0;
    let deletions = 0;
    for (const line of trimmed.split("\n")) {
      if (line.startsWith("+") && !line.startsWith("+++")) additions++;
      else if (line.startsWith("-") && !line.startsWith("---")) deletions++;
    }
    files.push({ path, patch: trimmed, additions, deletions });
  }
  return files;
}

function basename(filePath: string): string {
  return filePath.split("/").pop() ?? filePath;
}

function dirname(filePath: string): string {
  const parts = filePath.split("/");
  parts.pop();
  return parts.join("/");
}

interface DiffDrawerProps {
  instanceId: string;
  /** Known files from the sidecar — used to separate tracked vs other changes. */
  knownFiles?: FileChange[];
  workingDirectory?: string;
  onClose: () => void;
  scrollToFile?: string;
}

export function DiffDrawer({
  instanceId,
  knownFiles,
  workingDirectory,
  onClose,
  scrollToFile,
}: DiffDrawerProps) {
  const { theme } = useTheme();
  const [diff, setDiff] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [diffStyle, setDiffStyle] = useState<"unified" | "split">("unified");
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set());
  const [otherExpanded, setOtherExpanded] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const allFileDiffs = useMemo(() => (diff ? splitPatch(diff) : []), [diff]);

  // Build a set of relative paths from the sidecar's known files
  const knownRelPaths = useMemo(() => {
    if (!knownFiles || !workingDirectory) return null;
    const s = new Set<string>();
    for (const f of knownFiles) {
      const rel = f.path.startsWith(workingDirectory)
        ? f.path.slice(workingDirectory.length).replace(/^\//, "")
        : f.path;
      s.add(rel);
    }
    return s;
  }, [knownFiles, workingDirectory]);

  // Split into tracked files (from sidecar) and other files (git-only / generated)
  const { tracked, other } = useMemo(() => {
    const t: FilePatch[] = [];
    const o: FilePatch[] = [];
    for (const f of allFileDiffs) {
      if (knownRelPaths && knownRelPaths.has(f.path)) {
        t.push(f);
      } else {
        o.push(f);
      }
    }
    // If we don't have knownFiles, treat generated files as "other"
    if (!knownRelPaths) {
      const main: FilePatch[] = [];
      const gen: FilePatch[] = [];
      for (const f of allFileDiffs) {
        if (isGenerated(f.path)) gen.push(f);
        else main.push(f);
      }
      return { tracked: main, other: gen };
    }
    return { tracked: t, other: o };
  }, [allFileDiffs, knownRelPaths]);

  // Initialize collapsed from generated files in the "other" list
  useEffect(() => {
    if (allFileDiffs.length === 0) return;
    const auto = new Set<string>();
    for (const f of other) {
      if (isGenerated(f.path)) auto.add(f.path);
    }
    setCollapsedPaths(auto);
  }, [allFileDiffs, other]);

  const toggleCollapsed = useCallback((path: string) => {
    setCollapsedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchInstanceDiff(instanceId)
      .then((d) => {
        if (!cancelled) {
          setDiff(d);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [instanceId]);

  // Scroll to file after diff loads
  useEffect(() => {
    if (!scrollToFile || allFileDiffs.length === 0 || !contentRef.current) return;
    // Un-collapse if the target was collapsed, and expand "other" if needed
    setCollapsedPaths((prev) => {
      if (!prev.has(scrollToFile)) return prev;
      const next = new Set(prev);
      next.delete(scrollToFile);
      return next;
    });
    if (other.some((f) => f.path === scrollToFile)) {
      setOtherExpanded(true);
    }
    const timer = setTimeout(() => {
      const el = contentRef.current?.querySelector(
        `[data-file-path="${CSS.escape(scrollToFile)}"]`,
      );
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 150);
    return () => clearTimeout(timer);
  }, [scrollToFile, allFileDiffs, other]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const diffOptions = useMemo(
    () => ({
      diffStyle: diffStyle as "unified" | "split",
      theme: theme === "dark" ? ("github-dark" as const) : ("github-light" as const),
      themeType: theme as "dark" | "light",
      disableFileHeader: true,
    }),
    [diffStyle, theme],
  );

  const scrollToPath = useCallback(
    (path: string) => {
      // Expand if in other section
      if (other.some((f) => f.path === path)) setOtherExpanded(true);
      // Un-collapse
      setCollapsedPaths((prev) => {
        if (!prev.has(path)) return prev;
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
      requestAnimationFrame(() => {
        const el = contentRef.current?.querySelector(`[data-file-path="${CSS.escape(path)}"]`);
        el?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    },
    [other],
  );

  const renderFileSection = (file: FilePatch) => {
    const isCollapsed = collapsedPaths.has(file.path);
    return (
      <div key={file.path} data-file-path={file.path}>
        <StickyFileHeader
          file={file}
          isCollapsed={isCollapsed}
          onToggle={() => toggleCollapsed(file.path)}
        />
        {!isCollapsed && <PatchDiff patch={file.patch} options={diffOptions} />}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      {/* Backdrop */}
      <div className="animate-fade-in absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Drawer panel */}
      <div
        className="diff-drawer animate-slide-in-right relative ml-auto flex h-full w-full max-w-[90vw] flex-col overflow-hidden border-l border-border bg-surface shadow-2xl lg:max-w-[80vw]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-border/60 px-4 py-3">
          <div className="flex items-center gap-3">
            <h2 className="text-[0.9375rem] font-semibold text-text-bright">Changes</h2>
            {allFileDiffs.length > 0 && (
              <span className="text-[0.75rem] text-muted">
                {allFileDiffs.length} file{allFileDiffs.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* Split/Unified toggle */}
            <div className="flex overflow-hidden rounded-md border border-border/60 text-[0.75rem]">
              <button
                type="button"
                onClick={() => setDiffStyle("unified")}
                className={`px-2.5 py-1 font-medium transition-colors ${
                  diffStyle === "unified"
                    ? "bg-surface-hover text-text-bright"
                    : "text-muted hover:text-text"
                }`}
              >
                Unified
              </button>
              <button
                type="button"
                onClick={() => setDiffStyle("split")}
                className={`border-l border-border/60 px-2.5 py-1 font-medium transition-colors ${
                  diffStyle === "split"
                    ? "bg-surface-hover text-text-bright"
                    : "text-muted hover:text-text"
                }`}
              >
                Split
              </button>
            </div>

            <Button variant="icon" size="icon-sm" onClick={onClose}>
              <X size={16} />
            </Button>
          </div>
        </div>

        {/* Two-column layout: file sidebar + diff content */}
        <div className="flex min-h-0 flex-1">
          {/* File sidebar */}
          {allFileDiffs.length > 1 && (
            <div className="w-56 shrink-0 overflow-y-auto border-r border-border/40 bg-panel-header/30 py-1">
              {tracked.map((file) => (
                <button
                  key={file.path}
                  type="button"
                  onClick={() => scrollToPath(file.path)}
                  className="flex w-full items-center gap-1.5 px-3 py-1 text-left text-[0.6875rem] transition-colors hover:bg-surface-hover"
                >
                  <FileIcon path={file.path} size={13} />
                  <span className="min-w-0 flex-1 truncate text-text">{basename(file.path)}</span>
                  <span className="shrink-0 tabular-nums text-[0.625rem]">
                    <span className="text-green-400">+{file.additions}</span>
                    <span className="text-muted/30"> </span>
                    <span className="text-red-400">-{file.deletions}</span>
                  </span>
                </button>
              ))}
              {other.length > 0 && (
                <>
                  <div className="mx-3 my-1 border-t border-border/30" />
                  <div className="px-3 py-1 text-[0.625rem] font-medium text-muted/50">
                    Other changes
                  </div>
                  {other.map((file) => (
                    <button
                      key={file.path}
                      type="button"
                      onClick={() => scrollToPath(file.path)}
                      className="flex w-full items-center gap-1.5 px-3 py-1 text-left text-[0.6875rem] transition-colors hover:bg-surface-hover"
                    >
                      <FileIcon path={file.path} size={13} />
                      <span className="min-w-0 flex-1 truncate text-muted">
                        {basename(file.path)}
                      </span>
                    </button>
                  ))}
                </>
              )}
            </div>
          )}

          {/* Diff content */}
          <div className="flex-1 overflow-auto" ref={contentRef}>
            {loading && (
              <div className="flex items-center justify-center py-20">
                <Spinner size={24} />
              </div>
            )}

            {error && (
              <div className="px-6 py-10 text-center text-[0.875rem] text-red-400">{error}</div>
            )}

            {!loading && !error && diff !== null && (
              <>
                {allFileDiffs.length === 0 ? (
                  <div className="px-6 py-10 text-center text-[0.875rem] text-muted">
                    No changes detected.
                  </div>
                ) : (
                  <div className="flex flex-col">
                    {tracked.map(renderFileSection)}
                    {other.length > 0 && (
                      <>
                        <button
                          type="button"
                          onClick={() => setOtherExpanded((p) => !p)}
                          className="sticky top-0 z-20 flex items-center gap-2 border-y border-border/40 bg-panel-header/80 px-4 py-2 text-[0.75rem] font-medium text-muted backdrop-blur-sm transition-colors hover:text-text"
                        >
                          <ChevronRight
                            size={12}
                            className={`shrink-0 transition-transform duration-150 ${otherExpanded ? "rotate-90" : ""}`}
                          />
                          {other.length} other file{other.length !== 1 ? "s" : ""} changed
                          <span className="text-muted/50">(lockfiles, generated)</span>
                        </button>
                        {otherExpanded && other.map(renderFileSection)}
                      </>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Our own sticky file header — replaces the library's built-in one. */
function StickyFileHeader({
  file,
  isCollapsed,
  onToggle,
}: {
  file: FilePatch;
  isCollapsed: boolean;
  onToggle: () => void;
}) {
  const dir = dirname(file.path);
  return (
    <button
      type="button"
      onClick={onToggle}
      className="sticky top-0 z-10 flex w-full items-center gap-2 border-b border-border/40 bg-panel-header/90 px-4 py-2 text-left text-[0.75rem] backdrop-blur-sm transition-colors hover:bg-surface-hover"
    >
      <ChevronRight
        size={12}
        className={`shrink-0 text-muted transition-transform duration-150 ${isCollapsed ? "" : "rotate-90"}`}
      />
      <FileIcon path={file.path} size={14} />
      <span className="font-medium text-text-bright">{basename(file.path)}</span>
      {dir && <span className="truncate text-muted/50">{dir}</span>}
      <span className="ml-auto shrink-0 tabular-nums">
        <span className="text-green-400">+{file.additions}</span>
        <span className="text-muted/40"> / </span>
        <span className="text-red-400">-{file.deletions}</span>
      </span>
    </button>
  );
}
