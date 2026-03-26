interface ResponseDividerProps {
  durationLabel: string;
}

export function ResponseDivider({ durationLabel }: ResponseDividerProps) {
  return (
    <div className="my-1 flex items-center gap-3">
      <span className="h-px flex-1 bg-border/50" />
      <span className="rounded-lg bg-bg px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-muted/80">
        Response{durationLabel}
      </span>
      <span className="h-px flex-1 bg-border/50" />
    </div>
  );
}
