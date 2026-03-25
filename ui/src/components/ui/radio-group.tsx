import { RadioGroup as BaseRadioGroup } from "@base-ui/react/radio-group";
import { Radio as BaseRadio } from "@base-ui/react/radio";
import type { ReactNode } from "react";

interface RadioGroupProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  name?: string;
  className?: string;
  children: ReactNode;
}

function RadioGroupRoot({
  value,
  defaultValue,
  onValueChange,
  disabled,
  name,
  className = "",
  children,
}: RadioGroupProps) {
  return (
    <BaseRadioGroup
      value={value}
      defaultValue={defaultValue}
      onValueChange={onValueChange}
      disabled={disabled}
      name={name}
      className={`flex gap-4 ${className}`}
    >
      {children}
    </BaseRadioGroup>
  );
}

interface RadioGroupItemProps {
  value: string;
  disabled?: boolean;
  id?: string;
  className?: string;
  children?: ReactNode;
}

function RadioGroupItem({ value, disabled, id, className = "", children }: RadioGroupItemProps) {
  return (
    <BaseRadio.Root
      value={value}
      disabled={disabled}
      id={id}
      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 border-border transition-colors hover:border-border-hover data-[checked]:border-accent data-[checked]:bg-accent disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
    >
      <BaseRadio.Indicator className="h-1.5 w-1.5 rounded-full bg-white" />
      {children}
    </BaseRadio.Root>
  );
}

interface RadioGroupFieldProps extends RadioGroupItemProps {
  label: ReactNode;
  id?: string;
}

function RadioGroupField({ label, id, ...props }: RadioGroupFieldProps) {
  const fieldId = id ?? `radio-${Math.random().toString(36).slice(2, 8)}`;
  return (
    <div className="flex items-center gap-2">
      <RadioGroupItem id={fieldId} {...props} />
      <label htmlFor={fieldId} className="cursor-pointer text-xs font-medium text-text">
        {label}
      </label>
    </div>
  );
}

export { RadioGroupRoot as RadioGroup, RadioGroupItem, RadioGroupField };
