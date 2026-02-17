import { forwardRef, type InputHTMLAttributes } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className = "", ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={`w-full rounded-lg border border-border bg-bg px-3 py-2 text-[0.8125rem] text-text transition-colors placeholder:text-muted focus:border-accent focus:ring-1 focus:ring-accent-dim focus:outline-none ${className}`}
        {...props}
      />
    );
  },
);
