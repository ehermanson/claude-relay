import { useRef } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useProjectContext } from "../context/project-context";
import { useMediaQuery } from "../hooks/use-media-query";
import { Spinner } from "../components/ui/spinner";
import { Badge } from "../components/ui/badge";
import { Tooltip } from "../components/ui/tooltip";
import { Drawer } from "../components/ui/drawer";
import { MarkdownContent } from "../components/chat/markdown-content";
import type { BeadIssue } from "@shared/types";

// ─── Constants ──────────────────────────────────────────────────────────────

const priorityLabels: Record<number, string> = {
  0: "P0",
  1: "P1",
  2: "P2",
  3: "P3",
  4: "P4",
};

const priorityVariants: Record<number, "error" | "warning" | "accent" | "default"> = {
  0: "error",
  1: "warning",
  2: "accent",
  3: "default",
  4: "default",
};

const statusLabels: Record<string, string> = {
  open: "Open",
  in_progress: "In Progress",
  blocked: "Blocked",
  deferred: "Deferred",
  closed: "Closed",
};

const statusVariants: Record<string, "accent" | "warning" | "error" | "default" | "success"> = {
  open: "accent",
  in_progress: "warning",
  blocked: "error",
  deferred: "default",
  closed: "success",
};

const statusDotColors: Record<string, string> = {
  open: "bg-accent",
  in_progress: "bg-warning",
  blocked: "bg-error",
  deferred: "bg-muted",
  closed: "bg-accent",
};

const STATUS_ORDER = ["in_progress", "open", "blocked", "deferred", "closed"] as const;

// ─── Issue Card ─────────────────────────────────────────────────────────────

function IssueCard({ issue, onClick }: { issue: BeadIssue; onClick: () => void }) {
  const timeAgo = formatTimeAgo(issue.updated_at);

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-left transition-colors hover:border-border-bright hover:bg-surface-hover"
    >
      <div className="flex items-center gap-1.5">
        <span className="shrink-0 font-mono text-[0.625rem] text-muted">{issue.id}</span>
        <span className="truncate text-[0.8125rem] font-medium text-text-bright">
          {issue.title}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <Badge variant={priorityVariants[issue.priority] ?? "default"}>
          {priorityLabels[issue.priority] ?? `P${issue.priority}`}
        </Badge>
        <Badge>{issue.issue_type}</Badge>
        {issue.dependency_count > 0 && (
          <Tooltip
            content={`Blocked by ${issue.dependency_count} issue${issue.dependency_count !== 1 ? "s" : ""}`}
          >
            <span className="inline-flex items-center gap-1 text-[0.625rem] text-muted">
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
              </svg>
              {issue.dependency_count}
            </span>
          </Tooltip>
        )}
        <span className="ml-auto shrink-0 text-[0.625rem] text-muted">{timeAgo}</span>
      </div>
    </button>
  );
}

// ─── Issue Drawer ───────────────────────────────────────────────────────────

function IssueDrawer({
  issue,
  open,
  onClose,
  onSelectIssue,
}: {
  issue: BeadIssue | null;
  open: boolean;
  onClose: () => void;
  onSelectIssue: (id: string) => void;
}) {
  // Keep the last non-null issue so content stays visible during exit animation
  const lastIssue = useRef<BeadIssue | null>(null);
  if (issue) lastIssue.current = issue;
  const display = issue ?? lastIssue.current;

  return (
    <Drawer.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Drawer.Content>
        {display && (
          <>
            <Drawer.Header className="items-start">
              <div className="min-w-0 flex-1">
                <Drawer.Title>{display.title}</Drawer.Title>
                <span className="shrink-0 font-mono text-xs text-muted">{display.id}</span>
              </div>
              <Drawer.Close />
            </Drawer.Header>
            <Drawer.Body className="px-5 py-4">
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <Badge variant={statusVariants[display.status] ?? "default"}>
                  {statusLabels[display.status] ?? display.status}
                </Badge>
                <Badge variant={priorityVariants[display.priority] ?? "default"}>
                  {priorityLabels[display.priority] ?? `P${display.priority}`}
                </Badge>
                <Badge>{display.issue_type}</Badge>
              </div>

              {/* Dependencies */}
              {display.dependencies && display.dependencies.length > 0 && (
                <div className="mb-4">
                  <h4 className="mb-1.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-muted">
                    Blocked by
                  </h4>
                  <div className="flex flex-col gap-1">
                    {display.dependencies.map((dep) => (
                      <button
                        key={dep.id}
                        type="button"
                        onClick={() => onSelectIssue(dep.id)}
                        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-hover"
                      >
                        <span
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDotColors[dep.status] ?? "bg-muted"}`}
                        />
                        <span className="font-mono text-[0.625rem] text-muted">{dep.id}</span>
                        <span className="truncate text-[0.8125rem] text-text-bright">
                          {dep.title}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Dependents */}
              {display.dependents && display.dependents.length > 0 && (
                <div className="mb-4">
                  <h4 className="mb-1.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-muted">
                    Blocks
                  </h4>
                  <div className="flex flex-col gap-1">
                    {display.dependents.map((dep) => (
                      <button
                        key={dep.id}
                        type="button"
                        onClick={() => onSelectIssue(dep.id)}
                        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-hover"
                      >
                        <span
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDotColors[dep.status] ?? "bg-muted"}`}
                        />
                        <span className="font-mono text-[0.625rem] text-muted">{dep.id}</span>
                        <span className="truncate text-[0.8125rem] text-text-bright">
                          {dep.title}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="mb-4 text-[0.6875rem] text-muted">
                Updated {formatTimeAgo(display.updated_at)}
              </div>
              {display.description ? (
                <div className="prose-sm text-sm">
                  <MarkdownContent text={display.description} />
                </div>
              ) : (
                <p className="text-sm text-muted italic">No description</p>
              )}
            </Drawer.Body>
          </>
        )}
      </Drawer.Content>
    </Drawer.Root>
  );
}

function formatTimeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = Date.now();
  const diffMs = now - date.getTime();
  if (isNaN(diffMs)) return "";
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

// ─── Kanban Column ──────────────────────────────────────────────────────────

function KanbanColumn({
  status,
  issues,
  mobile,
  onSelectIssue,
}: {
  status: string;
  issues: BeadIssue[];
  mobile?: boolean;
  onSelectIssue: (id: string) => void;
}) {
  if (issues.length === 0) return null;

  const label = statusLabels[status] ?? status;
  const dotColor = statusDotColors[status] ?? "bg-muted";

  return (
    <div className={mobile ? "flex flex-col" : "flex min-w-[260px] max-w-[260px] flex-col"}>
      <div className="mb-2 flex items-center gap-2 px-1">
        <span className={`h-2 w-2 rounded-full ${dotColor}`} />
        <h3 className="text-[0.6875rem] font-semibold uppercase tracking-wider text-muted">
          {label}
        </h3>
        <span className="text-[0.625rem] text-muted/60">{issues.length}</span>
      </div>
      <div
        className={
          mobile ? "flex flex-col gap-2" : "flex flex-1 flex-col gap-2 overflow-y-auto pr-1"
        }
      >
        {issues.map((issue) => (
          <IssueCard key={issue.id} issue={issue} onClick={() => onSelectIssue(issue.id)} />
        ))}
      </div>
    </div>
  );
}

// ─── Main ───────────────────────────────────────────────────────────────────

export function IssuesPage() {
  const { artifacts, loading, error } = useProjectContext();
  const isMobile = useMediaQuery("(max-width: 768px)");
  const { issue: selectedId } = useSearch({
    from: "/_app/projects/$projectId/issues/",
  });
  const navigate = useNavigate();

  const selectIssue = (id: string) => {
    navigate({ search: { issue: id } });
  };

  const closeDrawer = () => {
    navigate({ search: {} });
  };

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner size={20} className="text-muted" />
      </div>
    );
  }

  if (error || !artifacts) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-10 text-center">
        <p className="mb-1 text-sm font-medium text-text">Project not found</p>
        <span className="text-xs text-muted">{error || "Could not load project artifacts"}</span>
      </div>
    );
  }

  const issues = artifacts.beadsIssues;
  if (!issues || issues.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="mb-1 text-sm text-muted">No issues found</p>
        <span className="text-xs text-muted opacity-60">
          Initialize beads with{" "}
          <code className="rounded bg-surface-hover px-1.5 py-0.5 font-mono">bd init</code> to start
          tracking issues
        </span>
      </div>
    );
  }

  const selectedIssue = selectedId ? (issues.find((i) => i.id === selectedId) ?? null) : null;

  const grouped = Object.fromEntries(
    STATUS_ORDER.map((s) => [s, issues.filter((i) => i.status === s)]),
  );

  if (isMobile) {
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-6 px-4 py-4">
          {STATUS_ORDER.map((s) => (
            <KanbanColumn
              key={s}
              status={s}
              issues={grouped[s]}
              mobile
              onSelectIssue={selectIssue}
            />
          ))}
        </div>
        <IssueDrawer
          issue={selectedIssue}
          open={!!selectedId}
          onClose={closeDrawer}
          onSelectIssue={selectIssue}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex flex-1 gap-4 overflow-x-auto px-6 py-4">
        {STATUS_ORDER.map((s) => (
          <KanbanColumn key={s} status={s} issues={grouped[s]} onSelectIssue={selectIssue} />
        ))}
      </div>
      <IssueDrawer
        issue={selectedIssue}
        open={!!selectedId}
        onClose={closeDrawer}
        onSelectIssue={selectIssue}
      />
    </div>
  );
}
