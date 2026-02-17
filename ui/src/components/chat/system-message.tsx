interface SystemMessageProps {
  text: string;
  isError?: boolean;
}

export function SystemMessage({ text, isError }: SystemMessageProps) {
  return (
    <div
      className={`animate-fade-in self-center px-4 py-1.5 text-center text-[0.6875rem] leading-relaxed ${
        isError ? "rounded-lg bg-error-dim text-error" : "text-muted/60"
      }`}
    >
      {text}
    </div>
  );
}
