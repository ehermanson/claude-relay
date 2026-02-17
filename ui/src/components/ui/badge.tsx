import type { ReactNode, HTMLAttributes } from "react";

type BadgeVariant = "default" | "accent" | "warning" | "error" | "claude" | "success";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  children: ReactNode;
  /** Show a dot indicator before text */
  dot?: boolean;
  /** Dot color class override (e.g. "bg-warning animate-pulse-dot") */
  dotClass?: string;
}

const variants: Record<BadgeVariant, string> = {
  default: "bg-surface-hover text-muted",
  accent: "bg-accent/10 text-accent",
  warning: "bg-warning/10 text-warning",
  error: "bg-error/10 text-error",
  claude: "bg-claude-dim text-claude",
  success: "bg-accent-dim text-accent",
};

export function Badge({
  variant = "default",
  dot,
  dotClass,
  children,
  className = "",
  ...props
}: BadgeProps) {
  const resolvedDotClass = dotClass ?? (variant === "default" ? "bg-muted" : "");

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${variants[variant]} ${className}`}
      {...props}
    >
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${resolvedDotClass}`} />}
      {children}
    </span>
  );
}
