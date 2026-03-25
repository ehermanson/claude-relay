/**
 * Shared header primitives for chat and space views.
 * Keeps breadcrumb, branch badge, and token badge consistent.
 */

import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Zap } from "lucide-react";
import { Tooltip } from "./tooltip";
import { formatTokens } from "@/lib/utils";

// ── Container ────────────────────────────────────────────────────────

interface ViewHeaderProps {
  children: ReactNode;
}

export function ViewHeader({ children }: ViewHeaderProps) {
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-border/70 px-4 py-2.5">
      {children}
    </div>
  );
}

// ── Breadcrumb: [project] > ──────────────────────────────────────────

interface ViewHeaderBreadcrumbProps {
  to: string;
  params: Record<string, string>;
  label: string;
  /** Show as mobile back button only (hidden on desktop) */
  mobileOnly?: boolean;
}

export function ViewHeaderBreadcrumb({ to, params, label, mobileOnly }: ViewHeaderBreadcrumbProps) {
  return (
    <>
      {/* Mobile: back arrow */}
      <Tooltip content="Back">
        <Link
          to={to}
          params={params}
          className="hidden h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-hover hover:text-text max-[768px]:flex"
        >
          <ChevronLeft size={16} strokeWidth={2} />
        </Link>
      </Tooltip>
      {/* Desktop: text link + chevron */}
      {!mobileOnly && (
        <>
          <Link
            to={to}
            params={params}
            className="hidden text-[0.8125rem] font-medium text-muted transition-colors hover:text-text sm:block"
          >
            {label}
          </Link>
          <ChevronLeft
            size={12}
            strokeWidth={2.5}
            className="hidden shrink-0 rotate-180 text-muted/40 sm:block"
          />
        </>
      )}
    </>
  );
}

// ── Branch badge ─────────────────────────────────────────────────────

interface BranchBadgeProps {
  branch: string;
  tooltip?: string;
}

export function BranchBadge({ branch, tooltip }: BranchBadgeProps) {
  const badge = (
    <span className="hidden shrink-0 rounded-full bg-surface-hover px-2 py-0.5 text-[0.6875rem] font-medium text-muted sm:inline-flex">
      {branch}
    </span>
  );
  return tooltip ? <Tooltip content={tooltip}>{badge}</Tooltip> : badge;
}

// ── Token badge ──────────────────────────────────────────────────────

interface TokenBadgeProps {
  tokens: number;
  tooltip?: ReactNode;
}

export function TokenBadge({ tokens, tooltip }: TokenBadgeProps) {
  if (tokens <= 0) return null;
  const badge = (
    <span className="hidden shrink-0 items-center gap-1 text-[0.6875rem] text-muted sm:inline-flex">
      <Zap size={10} />
      {formatTokens(tokens)}
    </span>
  );
  return tooltip ? <Tooltip content={tooltip}>{badge}</Tooltip> : badge;
}

// ── Title area (wraps title + badges in a flex row) ──────────────────

interface ViewHeaderTitleProps {
  children: ReactNode;
}

export function ViewHeaderTitle({ children }: ViewHeaderTitleProps) {
  return <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>;
}
