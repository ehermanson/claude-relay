import { useState } from "react";
import { ChevronDown, Info } from "lucide-react";
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
        <Info size={14} className="shrink-0 text-accent" />
        <span className="font-medium text-accent">Agent result</span>
        <span className="truncate text-muted">{title}</span>
        <ChevronDown
          size={12}
          strokeWidth={2.5}
          className={`ml-auto shrink-0 text-muted transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </button>
      {expanded && (
        <div className="border-t border-border px-4 py-3 text-[0.8125rem]">
          <MarkdownContent text={result} />
        </div>
      )}
    </div>
  );
}
