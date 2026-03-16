import { useState, useEffect } from "react";
import { createFileRoute, useParams, Link } from "@tanstack/react-router";
import { ChevronLeft, GitBranch } from "lucide-react";
import { fetchSpaceDetail, fetchSpaceDiff } from "../../../../../../lib/api";
import type { SpaceInfo } from "@shared/types";

function SpaceDiffView() {
  const { projectId, spaceId } = useParams({
    from: "/_app/projects/$projectId/spaces/$spaceId/diff",
  });
  const [space, setSpace] = useState<SpaceInfo | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([fetchSpaceDetail(spaceId).then(setSpace), fetchSpaceDiff(spaceId).then(setDiff)])
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [spaceId]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted">Loading diff...</div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2.5">
        <Link
          to="/projects/$projectId/spaces/$spaceId"
          params={{ projectId, spaceId }}
          className="flex h-6 w-6 items-center justify-center rounded text-muted transition-colors hover:bg-surface-hover hover:text-text"
        >
          <ChevronLeft size={16} strokeWidth={2} />
        </Link>
        <GitBranch size={14} className="shrink-0 text-accent" />
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-text-bright">
            {space?.name || "Space"} — Diff
          </span>
          {space?.gitBranch && (
            <span className="rounded-full bg-surface-hover px-2 py-0.5 text-[0.6875rem] text-muted">
              {space.gitBranch}
            </span>
          )}
        </div>
      </div>

      {/* Diff content */}
      <div className="flex-1 overflow-auto p-4">
        {diff ? (
          <pre className="whitespace-pre-wrap rounded-lg bg-surface-hover p-4 font-mono text-xs leading-relaxed text-text">
            {diff}
          </pre>
        ) : (
          <div className="flex items-center justify-center py-12 text-sm text-muted">
            No changes in this space yet
          </div>
        )}
      </div>
    </div>
  );
}

export const Route = createFileRoute("/_app/projects/$projectId/spaces/$spaceId/diff")({
  component: SpaceDiffView,
});
