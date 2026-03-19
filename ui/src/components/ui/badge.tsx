import type { ReactNode, HTMLAttributes } from "react";

type BadgeVariant = "default" | "accent" | "warning" | "error" | "claude" | "success";
type BadgeSize = "default" | "sm";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: BadgeSize;
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

const sizes: Record<BadgeSize, string> = {
  default: "px-2.5 py-1 text-xs gap-1.5",
  sm: "px-1.5 py-0.5 text-[0.625rem] gap-1",
};

export function Badge({
  variant = "default",
  size = "default",
  dot,
  dotClass,
  children,
  className = "",
  ...props
}: BadgeProps) {
  const resolvedDotClass = dotClass ?? (variant === "default" ? "bg-muted" : "");

  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-md font-medium ${sizes[size]} ${variants[variant]} ${className}`}
      {...props}
    >
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${resolvedDotClass}`} />}
      {children}
    </span>
  );
}
