import { Separator } from "react-resizable-panels";

export function ResizableHandle({ className = "" }: { className?: string }) {
  return (
    <Separator
      className={`relative flex w-px items-center justify-center bg-border/50 after:absolute after:inset-y-0 after:left-1/2 after:w-2 after:-translate-x-1/2 after:content-[''] ${className}`}
    />
  );
}
