import {
  forwardRef,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
  type SelectHTMLAttributes,
} from "react";

type InputSize = "sm" | "md";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Size variant. Default: "md" */
  inputSize?: InputSize;
}

const base =
  "rounded-lg border border-border bg-bg text-text shadow-sm shadow-black/5 transition-all duration-150 placeholder:text-muted/50 focus:border-accent focus:ring-2 focus:ring-accent/15 focus:outline-none";

const sizes: Record<InputSize, string> = {
  sm: "rounded-md px-2.5 py-1.5 text-xs",
  md: "px-3 py-2 text-[0.8125rem]",
};

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className = "", inputSize = "md", ...props }, ref) => {
    return (
      <input ref={ref} className={`w-full ${base} ${sizes[inputSize]} ${className}`} {...props} />
    );
  },
);

// ── Textarea ──────────────────────────────────────────────────────────────

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  inputSize?: InputSize;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className = "", inputSize = "md", ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        className={`w-full ${base} ${sizes[inputSize]} ${className}`}
        {...props}
      />
    );
  },
);

// ── Select ────────────────────────────────────────────────────────────────

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  inputSize?: InputSize;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className = "", inputSize = "sm", ...props }, ref) => {
    return (
      <select
        ref={ref}
        className={`appearance-none bg-[length:16px_16px] bg-[position:right_6px_center] bg-no-repeat pr-7 w-fit ${base} ${sizes[inputSize]} ${className}`}
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
        }}
        {...props}
      />
    );
  },
);
