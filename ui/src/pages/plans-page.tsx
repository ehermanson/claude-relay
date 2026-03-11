import { useEffect, useRef } from "react";
import { useParams, useNavigate, useSearch, Link } from "@tanstack/react-router";
import { useProjectContext } from "../context/project-context";
import { MarkdownContent } from "../components/chat/markdown-content";
import { Collapsible } from "../components/ui/collapsible";
import { Tooltip } from "../components/ui/tooltip";
import type { ProjectPlan } from "@shared/types";

function formatDate(epoch: number): string {
  if (!epoch) return "";
  const d = new Date(epoch);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function PlanCard({
  plan,
  projectId,
  isOpen,
  onToggle,
}: {
  plan: ProjectPlan;
  projectId: string;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);

  // Scroll into view when opened via URL param
  useEffect(() => {
    if (isOpen) {
      cardRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, []); // Only on mount

  return (
    <div ref={cardRef} className="group/plan rounded-lg border border-border bg-surface">
      <Collapsible.Root open={isOpen} onOpenChange={onToggle}>
        <Collapsible.Trigger className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-surface-hover">
          <svg
            className="h-3 w-3 shrink-0 text-muted transition-transform data-[open]:rotate-90"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
          <span className="min-w-0 flex-1 truncate text-[0.8125rem] font-medium text-text-bright">
            {plan.title}
          </span>
          <Tooltip content="Open full view">
            <Link
              to="/projects/$projectId/plans/$planSlug"
              params={{ projectId, planSlug: plan.slug }}
              className="shrink-0 rounded p-1 text-muted opacity-0 transition-all hover:bg-surface-hover hover:text-text group-hover/plan:opacity-100"
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M15 3h6v6" />
                <path d="M10 14L21 3" />
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              </svg>
            </Link>
          </Tooltip>
          <span className="shrink-0 text-[0.6875rem] text-muted">
            {formatDate(plan.modifiedAt)}
          </span>
        </Collapsible.Trigger>
        <Collapsible.Content>
          <div className="border-t border-border px-3.5 py-3 text-[0.8125rem]">
            <MarkdownContent text={plan.content} />
          </div>
        </Collapsible.Content>
      </Collapsible.Root>
    </div>
  );
}

export function PlansPage() {
  const { projectId } = useParams({ strict: false }) as { projectId: string };
  const { plan: selectedPlan } = useSearch({
    from: "/_app/projects/$projectId/plans/",
  });
  const navigate = useNavigate();
  const { artifacts } = useProjectContext();

  if (artifacts.plans.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center py-20 text-center">
        <p className="mb-1 text-sm text-muted">No plans found</p>
        <span className="text-xs text-muted opacity-60">
          Implementation plans generated during sessions will appear here
        </span>
      </div>
    );
  }

  const togglePlan = (slug: string) => {
    if (selectedPlan === slug) {
      // Close — remove search param
      navigate({ search: {}, replace: true });
    } else {
      // Open — set search param
      navigate({ search: { plan: slug }, replace: true });
    }
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto px-6 py-6">
        <div className="flex flex-col gap-2">
          {artifacts.plans.map((plan) => (
            <PlanCard
              key={plan.slug}
              plan={plan}
              projectId={projectId}
              isOpen={selectedPlan === plan.slug}
              onToggle={() => togglePlan(plan.slug)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
