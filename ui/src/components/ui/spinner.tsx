interface SpinnerProps {
  /** Size in px. Default: 16 */
  size?: number;
  className?: string;
}

export function Spinner({ size = 16, className = "text-claude" }: SpinnerProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={`animate-spin ${className}`}
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeDasharray="50 20"
        strokeLinecap="round"
      />
    </svg>
  );
}
