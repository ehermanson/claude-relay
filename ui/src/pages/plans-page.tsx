import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, useSearch, Link } from "@tanstack/react-router";
import {
  ArrowDownNarrowWide,
  Check,
  ChevronRight,
  ExternalLink,
  NotebookPen,
  Search,
} from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { MarkdownContent } from "@/components/chat/markdown-content";
import { Collapsible } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Menu } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import { useProjectContext } from "@/context/project-context";
import {
  patchPlansSearch,
  togglePlanSearch,
} from "@/routes/_app/projects/$projectId/plans/-search";
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

type SortKey = "newest" | "oldest" | "alpha";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "newest", label: "Newest first" },
  { key: "oldest", label: "Oldest first" },
  { key: "alpha", label: "Alphabetical" },
];

function sortPlans(plans: ProjectPlan[], sortKey: SortKey): ProjectPlan[] {
  return [...plans].sort((a, b) => {
    switch (sortKey) {
      case "newest":
        return b.modifiedAt - a.modifiedAt;
      case "oldest":
        return a.modifiedAt - b.modifiedAt;
      case "alpha":
        return a.title.localeCompare(b.title);
      default:
        return 0;
    }
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

  useEffect(() => {
    if (isOpen) {
      cardRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, []); // Only on mount

  return (
    <div ref={cardRef} className="group/plan rounded-lg border border-border/70 bg-surface">
      <Collapsible.Root open={isOpen} onOpenChange={onToggle}>
        <Collapsible.Trigger className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-surface-hover">
          <ChevronRight className="h-3 w-3 shrink-0 text-muted transition-transform data-[open]:rotate-90" />
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
              <ExternalLink size={14} />
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
  const { projectId: routeProjectId } = useParams({ strict: false }) as { projectId: string };
  const {
    plan: selectedPlan,
    sort: sortParam,
    q: searchParam,
  } = useSearch({
    from: "/_app/projects/$projectId/plans/",
  });
  const navigate = useNavigate({ from: "/projects/$projectId/plans/" });
  const { artifacts } = useProjectContext();
  const projectId = artifacts.projectId || routeProjectId;
  const [searchInput, setSearchInput] = useState(searchParam ?? "");
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentSort: SortKey =
    sortParam && SORT_OPTIONS.some((o) => o.key === sortParam) ? (sortParam as SortKey) : "newest";

  const searchQuery = searchParam ?? "";

  const filteredAndSorted = useMemo(() => {
    let plans = artifacts.plans;
    if (searchQuery) {
      const lower = searchQuery.toLowerCase();
      plans = plans.filter(
        (p) => p.title.toLowerCase().includes(lower) || p.content.toLowerCase().includes(lower),
      );
    }
    return sortPlans(plans, currentSort);
  }, [artifacts.plans, searchQuery, currentSort]);

  const handleSearchChange = (value: string) => {
    setSearchInput(value);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      navigate({
        search: patchPlansSearch({ q: value || undefined }),
        replace: true,
      });
    }, 200);
  };

  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, []);

  if (artifacts.plans.length === 0) {
    return (
      <EmptyState
        icon={<NotebookPen size={24} strokeWidth={1.5} />}
        title="No plans yet"
        description="Implementation plans generated during chats will appear here"
      />
    );
  }

  const togglePlan = (slug: string) => {
    navigate({
      search: togglePlanSearch(slug),
      replace: true,
    });
  };

  const setSort = (key: SortKey) => {
    navigate({
      search: patchPlansSearch({
        sort: key === "newest" ? undefined : key,
      }),
      replace: true,
    });
  };

  const sortLabel = SORT_OPTIONS.find((o) => o.key === currentSort)?.label ?? "Newest first";

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto px-6 py-6">
        {/* Toolbar */}
        <div className="mb-3 flex items-center gap-2">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <Input
              type="text"
              value={searchInput}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Search plans..."
              className="h-8 !rounded-md !bg-surface !py-1.5 pl-8 pr-3"
            />
          </div>
          <Menu.Root>
            <Menu.Trigger className="flex h-8 items-center gap-1 rounded-md border border-border px-2.5 text-[0.75rem] font-medium text-muted transition-colors hover:bg-surface-hover hover:text-text">
              <ArrowDownNarrowWide size={12} />
              {sortLabel}
            </Menu.Trigger>
            <Menu.Content>
              {SORT_OPTIONS.map((option) => (
                <Menu.Item key={option.key} onClick={() => setSort(option.key)}>
                  <span className="flex-1">{option.label}</span>
                  {currentSort === option.key && <Check size={14} className="shrink-0" />}
                </Menu.Item>
              ))}
            </Menu.Content>
          </Menu.Root>
        </div>

        {/* Plans list */}
        {filteredAndSorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-sm text-muted">No plans match "{searchQuery}"</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {filteredAndSorted.map((plan) => (
              <PlanCard
                key={plan.slug}
                plan={plan}
                projectId={projectId}
                isOpen={selectedPlan === plan.slug}
                onToggle={() => togglePlan(plan.slug)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
