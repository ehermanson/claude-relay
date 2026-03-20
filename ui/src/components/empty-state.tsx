import type { ReactNode } from "react";

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description: string;
  children?: ReactNode;
}

export function EmptyState({ icon, title, description, children }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-surface-hover text-muted">
        {icon}
      </div>
      <p className="mb-1 text-sm font-medium text-text">{title}</p>
      <span className="text-xs text-muted">{description}</span>
      {children}
    </div>
  );
}
