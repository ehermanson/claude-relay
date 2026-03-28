import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import type { ReactNode } from "react";

interface TabsProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  children: ReactNode;
}

function TabsRoot({ value, defaultValue, onValueChange, children }: TabsProps) {
  return (
    <BaseTabs.Root
      value={value ?? undefined}
      defaultValue={defaultValue}
      onValueChange={(val) => onValueChange?.(val as string)}
    >
      {children}
    </BaseTabs.Root>
  );
}

interface TabsListProps {
  children: ReactNode;
  className?: string;
}

function TabsList({ children, className = "" }: TabsListProps) {
  return (
    <BaseTabs.List className={`flex gap-1 rounded-md bg-surface-hover p-0.5 ${className}`}>
      {children}
    </BaseTabs.List>
  );
}

interface TabProps {
  value: string;
  children: ReactNode;
  className?: string;
}

function Tab({ value, children, className = "" }: TabProps) {
  return (
    <BaseTabs.Tab
      value={value}
      className={`rounded px-2 py-0.5 text-[0.75rem] font-medium transition-colors text-muted hover:text-text data-[active]:bg-surface data-[active]:text-text-bright data-[active]:shadow-sm ${className}`}
    >
      {children}
    </BaseTabs.Tab>
  );
}

interface TabPanelProps {
  value: string;
  children: ReactNode;
  className?: string;
}

function TabPanel({ value, children, className = "" }: TabPanelProps) {
  return (
    <BaseTabs.Panel value={value} className={className}>
      {children}
    </BaseTabs.Panel>
  );
}

export const Tabs = {
  Root: TabsRoot,
  List: TabsList,
  Tab,
  Panel: TabPanel,
};
