import { forwardRef, type ButtonHTMLAttributes } from "react";

type ButtonVariant = "primary" | "ghost" | "danger" | "icon";
type ButtonSize = "sm" | "md" | "lg" | "icon-sm" | "icon-md";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Visual toggle state — renders the button with an accent-tinted background. */
  toggled?: boolean;
}

/// test

const base =
  "inline-flex items-center justify-center font-medium transition-all whitespace-nowrap duration-150 disabled:cursor-not-allowed disabled:opacity-40 active:scale-[0.97] active:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-1 focus-visible:ring-offset-bg";

const variants: Record<ButtonVariant, string> = {
  primary:
    "rounded-lg bg-accent text-white shadow-sm hover:bg-accent-hover hover:shadow-md active:shadow-sm",
  ghost: "rounded-lg text-muted hover:bg-surface-hover hover:text-text",
  danger: "rounded-lg text-error hover:bg-surface-hover",
  icon: "rounded-md text-muted hover:bg-surface-hover hover:text-text",
};

const toggledStyle = "bg-accent/10 text-accent hover:bg-accent/15 hover:text-accent";

const sizes: Record<ButtonSize, string> = {
  sm: "px-3 py-1 text-[0.75rem] gap-1.5",
  md: "px-3.5 py-1.5 text-[0.8125rem] gap-1.5",
  lg: "px-4 py-2.5 text-sm gap-2",
  "icon-sm": "h-6 w-6",
  "icon-md": "h-7 w-7",
};

function defaultSize(variant: ButtonVariant): ButtonSize {
  return variant === "icon" ? "icon-md" : "md";
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "ghost", size, toggled, className = "", children, ...props }, ref) => {
    const s = size ?? defaultSize(variant);
    return (
      <button
        ref={ref}
        className={`${base} ${variants[variant]} ${toggled ? toggledStyle : ""} ${sizes[s]} ${className}`}
        {...props}
      >
        {children}
      </button>
    );
  },
);
