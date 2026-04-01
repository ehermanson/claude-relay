/**
 * FilesPanel — Reusable file-change tree used in both the chat sidecar
 * and the space sidebar.
 */

import { memo, useMemo, useState } from "react";
import { FileDiff } from "lucide-react";
import { Collapsible } from "../ui/collapsible";
import { FileIcon } from "../ui/file-icon";
import { Tooltip } from "../ui/tooltip";
import { MiddleTruncate } from "../ui/middle-truncate";
import type { FileChange } from "@shared/types";

// =============================================================================
// Helpers
// =============================================================================

/** Strip the working directory prefix to show project-relative paths. */
export function relativePath(filePath: string, cwd: string): string {
  if (cwd && filePath.startsWith(cwd)) {
    const rel = filePath.slice(cwd.length);
    return rel.startsWith("/") ? rel.slice(1) : rel;
  }
  return filePath;
}

export function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 text-muted transition-transform duration-150 ${open ? "rotate-90" : ""}`}
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function DiffStats({ additions, deletions }: { additions?: number; deletions?: number }) {
  if (additions == null && deletions == null) return null;
  const add = additions ?? 0;
  const del = deletions ?? 0;
  return (
    <span className="sidecar-file-stats shrink-0 text-[0.6875rem] font-medium tabular-nums">
      <span className="text-green-400">+{add}</span>
      <span className="text-muted/40"> / </span>
      <span className="text-red-400">-{del}</span>
    </span>
  );
}

interface DirGroup {
  dir: string;
  files: { basename: string; file: FileChange }[];
  totalEdits: number;
  additions: number;
  deletions: number;
  hasDiffStats: boolean;
}

function groupFilesByDir(files: FileChange[], cwd: string): DirGroup[] {
  const compare = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
  const map = new Map<string, { basename: string; file: FileChange }[]>();
  for (const file of files) {
    const rel = relativePath(file.path, cwd);
    const parts = rel.split("/");
    const basename = parts.pop() || rel;
    const dir = parts.join("/") || ".";
    let group = map.get(dir);
    if (!group) {
      group = [];
      map.set(dir, group);
    }
    group.push({ basename, file });
  }

  return Array.from(map.entries())
    .map(([dir, dirFiles]) => {
      const sortedFiles = [...dirFiles].sort(
        (a, b) =>
          compare(a.basename, b.basename) ||
          compare(relativePath(a.file.path, cwd), relativePath(b.file.path, cwd)),
      );
      let additions = 0;
      let deletions = 0;
      let hasDiffStats = false;
      for (const { file } of sortedFiles) {
        if (file.additions != null || file.deletions != null) {
          hasDiffStats = true;
          additions += file.additions ?? 0;
          deletions += file.deletions ?? 0;
        }
      }
      return {
        dir,
        files: sortedFiles,
        totalEdits: sortedFiles.reduce((sum, f) => sum + f.file.editCount, 0),
        additions,
        deletions,
        hasDiffStats,
      };
    })
    .sort((a, b) => {
      if (a.dir === "." && b.dir !== ".") return 1;
      if (b.dir === "." && a.dir !== ".") return -1;
      return compare(a.dir, b.dir);
    });
}

// =============================================================================
// Component
// =============================================================================

export const FilesPanel = memo(function FilesPanel({
  files,
  cwd,
  onViewChanges,
  onFileClick,
}: {
  files: FileChange[];
  cwd: string;
  onViewChanges?: () => void;
  onFileClick?: (filePath: string) => void;
}) {
  const groups = useMemo(() => groupFilesByDir(files, cwd), [files, cwd]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleDir = (dir: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir);
      else next.add(dir);
      return next;
    });
  };

  const totalAdditions = groups.reduce((s, g) => s + g.additions, 0);
  const totalDeletions = groups.reduce((s, g) => s + g.deletions, 0);
  const hasDiffStats = groups.some((g) => g.hasDiffStats);

  return (
    <>
      {/* Header */}
      <div className="shrink-0 px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-[0.75rem] font-medium text-muted">
            {files.length} file{files.length !== 1 ? "s" : ""} changed
          </span>
          {hasDiffStats && (
            <span className="sidecar-header-stats text-[0.6875rem] font-medium tabular-nums">
              <span className="text-green-400">+{totalAdditions}</span>
              <span className="text-muted/40"> / </span>
              <span className="text-red-400">-{totalDeletions}</span>
            </span>
          )}
          {onViewChanges && (
            <Tooltip content="View full diff">
              <button
                type="button"
                onClick={onViewChanges}
                className="ml-auto flex items-center gap-1 rounded-md px-2 py-0.5 text-[0.6875rem] font-medium text-muted transition-colors hover:bg-surface-hover hover:text-text"
              >
                <FileDiff size={12} className="shrink-0" />
                <span className="sidecar-control-label">Full Diff</span>
              </button>
            </Tooltip>
          )}
        </div>
      </div>

      {/* File tree */}
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        <div className="flex flex-col">
          {groups.map((group) => {
            const isOpen = !collapsed.has(group.dir);
            const showDir = group.dir !== ".";

            return (
              <Collapsible.Root
                key={group.dir}
                open={isOpen}
                onOpenChange={() => toggleDir(group.dir)}
              >
                {showDir && (
                  <Collapsible.Trigger className="flex w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[0.8125rem] leading-snug transition-colors hover:bg-surface-hover">
                    <ChevronIcon open={isOpen} />
                    <FileIcon path={group.dir} kind="directory" size={15} />
                    <MiddleTruncate
                      text={group.dir}
                      className="min-w-0 flex-1 text-left font-medium text-text-bright"
                    />
                    {group.hasDiffStats ? (
                      <DiffStats additions={group.additions} deletions={group.deletions} />
                    ) : (
                      <span className="sidecar-file-stats shrink-0 text-[0.6875rem] font-medium text-muted/60">
                        {group.totalEdits > group.files.length
                          ? `${group.files.length} · ×${group.totalEdits}`
                          : `${group.files.length}`}
                      </span>
                    )}
                  </Collapsible.Trigger>
                )}
                <Collapsible.Content>
                  <div className={showDir ? "ml-5" : ""}>
                    {group.files.map(({ basename, file }) => (
                      <Tooltip key={file.path} content={relativePath(file.path, cwd)} side="left">
                        <div
                          className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[0.8125rem] leading-snug transition-colors hover:bg-surface-hover${onFileClick ? " cursor-pointer" : ""}`}
                          onClick={
                            onFileClick
                              ? () => onFileClick(relativePath(file.path, cwd))
                              : undefined
                          }
                        >
                          <FileIcon path={file.path} size={15} />
                          <span className="min-w-0 flex-1 truncate text-text">{basename}</span>
                          {file.additions != null || file.deletions != null ? (
                            <DiffStats additions={file.additions} deletions={file.deletions} />
                          ) : file.editCount > 1 ? (
                            <span className="sidecar-file-stats shrink-0 text-[0.6875rem] font-medium text-muted/60">
                              ×{file.editCount}
                            </span>
                          ) : null}
                        </div>
                      </Tooltip>
                    ))}
                  </div>
                </Collapsible.Content>
              </Collapsible.Root>
            );
          })}
        </div>
      </div>
    </>
  );
});
