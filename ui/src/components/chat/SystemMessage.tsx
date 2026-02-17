interface SystemMessageProps {
  text: string;
  isError?: boolean;
}

export function SystemMessage({ text, isError }: SystemMessageProps) {
  return (
    <div
      className={`animate-fade-in self-center bg-transparent px-3 py-1.5 text-center text-[0.6875rem] ${
        isError ? "text-error" : "text-muted opacity-60"
      }`}
    >
      {text}
    </div>
  );
}
