export function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-1.5 px-1 py-2">
      <span className="h-1 w-1 animate-pulse rounded-full bg-muted/30" />
      <span className="h-1 w-1 animate-pulse rounded-full bg-muted/30 [animation-delay:200ms]" />
      <span className="h-1 w-1 animate-pulse rounded-full bg-muted/30 [animation-delay:400ms]" />
    </div>
  );
}
