import { Switch as BaseSwitch } from "@base-ui/react/switch";
import type { ReactNode } from "react";

interface SwitchProps {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  name?: string;
  className?: string;
}

export function Switch({
  checked,
  defaultChecked,
  onCheckedChange,
  disabled,
  id,
  name,
  className = "",
}: SwitchProps) {
  return (
    <BaseSwitch.Root
      checked={checked}
      defaultChecked={defaultChecked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      id={id}
      name={name}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-border bg-surface-hover transition-colors data-[checked]:border-accent data-[checked]:bg-accent disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
    >
      <BaseSwitch.Thumb className="block h-3.5 w-3.5 translate-x-0.5 rounded-full bg-muted shadow-sm transition-all data-[checked]:translate-x-[17px] data-[checked]:bg-white" />
    </BaseSwitch.Root>
  );
}

interface SwitchFieldProps extends SwitchProps {
  label: ReactNode;
}

export function SwitchField({ label, id, ...props }: SwitchFieldProps) {
  const fieldId = id ?? `switch-${Math.random().toString(36).slice(2, 8)}`;
  return (
    <div className="flex items-center gap-2">
      <Switch id={fieldId} {...props} />
      <label htmlFor={fieldId} className="cursor-pointer text-[0.8125rem] text-text">
        {label}
      </label>
    </div>
  );
}
