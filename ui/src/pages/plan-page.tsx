import { useParams, Link } from "@tanstack/react-router";
import { useProjectContext } from "../context/project-context";
import { MarkdownContent } from "../components/chat/markdown-content";
import { Tooltip } from "../components/ui/tooltip";

function formatDate(epoch: number): string {
  if (!epoch) return "";
  const d = new Date(epoch);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function PlanPage() {
  const { projectId, planSlug } = useParams({ strict: false }) as {
    projectId: string;
    planSlug: string;
  };

  const { artifacts } = useProjectContext();

  const plan = artifacts.plans.find((p) => p.slug === planSlug);
  const dirName = artifacts.directory.split("/").pop() || projectId;

  if (!plan) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-10 text-center">
        <p className="mb-1 text-sm font-medium text-text">Plan not found</p>
        <Link
          to="/projects/$projectId/plans"
          params={{ projectId }}
          className="text-xs text-accent hover:underline"
        >
          Back to plans
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-6 py-3">
        <Tooltip content={`Back to ${dirName} plans`}>
          <Link
            to="/projects/$projectId/plans"
            params={{ projectId }}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-hover hover:text-text"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </Link>
        </Tooltip>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[0.9375rem] font-semibold tracking-tight text-text-bright">
            {plan.title}
          </h1>
          <p className="truncate text-xs text-muted">
            {dirName} &middot; {formatDate(plan.modifiedAt)}
          </p>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-6 text-[0.8125rem]">
          <MarkdownContent text={plan.content} />
        </div>
      </div>
    </div>
  );
}
