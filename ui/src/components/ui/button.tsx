import { forwardRef, type ButtonHTMLAttributes } from "react";

type ButtonVariant = "primary" | "ghost" | "danger" | "icon";
type ButtonSize = "sm" | "md" | "lg" | "icon-sm" | "icon-md";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const base =
  "inline-flex items-center justify-center font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40";

const variants: Record<ButtonVariant, string> = {
  primary: "rounded-lg bg-accent text-white hover:bg-accent-hover",
  ghost: "rounded-lg text-muted hover:bg-surface-hover hover:text-text",
  danger: "rounded-lg text-error hover:bg-surface-hover",
  icon: "rounded-md text-muted hover:bg-surface-hover hover:text-text",
};

const sizes: Record<ButtonSize, string> = {
  sm: "px-3 py-1 text-[0.75rem]",
  md: "px-3.5 py-1.5 text-[0.8125rem]",
  lg: "px-4 py-2.5 text-sm",
  "icon-sm": "h-6 w-6",
  "icon-md": "h-7 w-7",
};

function defaultSize(variant: ButtonVariant): ButtonSize {
  return variant === "icon" ? "icon-md" : "md";
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "ghost", size, className = "", children, ...props }, ref) => {
    const s = size ?? defaultSize(variant);
    return (
      <button
        ref={ref}
        className={`${base} ${variants[variant]} ${sizes[s]} ${className}`}
        {...props}
      >
        {children}
      </button>
    );
  },
);
