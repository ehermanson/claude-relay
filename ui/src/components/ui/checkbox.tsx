import { Checkbox as BaseCheckbox } from "@base-ui/react/checkbox";
import type { ReactNode } from "react";

interface CheckboxProps {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  name?: string;
  className?: string;
}

export function Checkbox({
  checked,
  defaultChecked,
  onCheckedChange,
  disabled,
  id,
  name,
  className = "",
}: CheckboxProps) {
  return (
    <BaseCheckbox.Root
      checked={checked}
      defaultChecked={defaultChecked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      id={id}
      name={name}
      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border border-border bg-bg transition-colors data-[checked]:border-accent data-[checked]:bg-accent disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
    >
      <BaseCheckbox.Indicator className="flex items-center justify-center text-white">
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={3.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </BaseCheckbox.Indicator>
    </BaseCheckbox.Root>
  );
}

interface CheckboxFieldProps extends CheckboxProps {
  label: ReactNode;
}

export function CheckboxField({ label, id, ...props }: CheckboxFieldProps) {
  const fieldId = id ?? `checkbox-${Math.random().toString(36).slice(2, 8)}`;
  return (
    <div className="flex items-center gap-2">
      <Checkbox id={fieldId} {...props} />
      <label htmlFor={fieldId} className="cursor-pointer text-[0.8125rem] text-muted">
        {label}
      </label>
    </div>
  );
}
