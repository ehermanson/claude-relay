import { Separator } from "react-resizable-panels";

export function ResizableHandle() {
  return (
    <Separator className="relative flex w-px items-center justify-center bg-border transition-colors after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 after:content-[''] hover:bg-accent active:bg-accent" />
  );
}
