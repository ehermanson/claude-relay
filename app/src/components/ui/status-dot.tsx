export type StatusDotVariant = "default" | "active" | "success" | "error";

const variantClass: Record<StatusDotVariant, string> = {
  default: "bg-muted",
  active: "animate-pulse-dot bg-warning",
  success: "bg-accent",
  error: "bg-error",
};

export function StatusDot({
  variant = "default",
  size = 5,
}: {
  variant?: StatusDotVariant;
  size?: number;
}) {
  return (
    <span
      className={`shrink-0 rounded-full ${variantClass[variant]}`}
      style={{ width: size, height: size }}
    />
  );
}
