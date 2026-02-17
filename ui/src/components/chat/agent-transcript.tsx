import { useState } from "react";
import { MarkdownContent } from "./markdown-content";

interface AgentTranscriptProps {
  title: string;
  result: string;
}

export function AgentTranscript({ title, result }: AgentTranscriptProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-border bg-panel">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[0.8125rem] transition-colors hover:bg-panel-content"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0 text-accent"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4" />
          <path d="M12 8h.01" />
        </svg>
        <span className="font-medium text-accent">Agent result</span>
        <span className="truncate text-muted">{title}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`ml-auto shrink-0 text-muted transition-transform ${expanded ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {expanded && (
        <div className="border-t border-border px-4 py-3 text-[0.8125rem]">
          <MarkdownContent text={result} />
        </div>
      )}
    </div>
  );
}
