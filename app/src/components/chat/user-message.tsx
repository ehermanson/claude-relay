import { useState } from "react";
import { TerminalSquare, ChevronDown, ChevronRight } from "lucide-react";
import { formatTimestamp } from "../../lib/utils";
import { MarkdownContent, ImageThumbnail, IMAGE_PATTERN } from "./markdown-content";

interface UserMessageProps {
  text: string;
  timestamp?: number;
}

// ── Extractors ───────────────────────────────────────────────────────

const TERMINAL_CONTEXT_PATTERN =
  /<terminal_context(?:\s+source="([^"]*)")?\s*>\n?([\s\S]*?)\n?<\/terminal_context>/g;

interface TerminalBlock {
  source: string;
  text: string;
}

function splitContent(text: string): {
  textPart: string;
  images: string[];
  terminalBlocks: TerminalBlock[];
} {
  const images: string[] = [];
  const terminalBlocks: TerminalBlock[] = [];

  let cleaned = text
    .replace(TERMINAL_CONTEXT_PATTERN, (_match, source: string | undefined, content: string) => {
      terminalBlocks.push({ source: source || "Terminal", text: content });
      return "";
    })
    .replace(IMAGE_PATTERN, (_match, filePath: string) => {
      images.push(filePath.trim());
      return "";
    })
    .trim();

  return { textPart: cleaned, images, terminalBlocks };
}

// ── Components ───────────────────────────────────────────────────────

function ImageRow({ images }: { images: string[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {images.map((filePath, i) => (
        <ImageThumbnail
          key={i}
          src={`/api/file?path=${encodeURIComponent(filePath)}`}
          alt="Image"
        />
      ))}
    </div>
  );
}

function TerminalAttachment({ block }: { block: TerminalBlock }) {
  const [expanded, setExpanded] = useState(false);
  const lineCount = block.text.split("\n").length;

  return (
    <div className="w-full overflow-hidden rounded-lg border border-border/50 bg-surface-inset/60">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left transition-colors hover:bg-surface-hover/50"
      >
        <TerminalSquare size={12} className="shrink-0 text-accent" />
        <span className="min-w-0 flex-1 truncate text-[0.6875rem] font-medium text-text">
          {block.source}
        </span>
        <span className="text-[0.625rem] text-muted">
          {lineCount} line{lineCount !== 1 ? "s" : ""}
        </span>
        {expanded ? (
          <ChevronDown size={12} className="shrink-0 text-muted" />
        ) : (
          <ChevronRight size={12} className="shrink-0 text-muted" />
        )}
      </button>
      {expanded && (
        <pre className="max-h-48 overflow-auto border-t border-border/30 px-2.5 py-2 font-mono text-[0.625rem] leading-relaxed text-text/70">
          {block.text}
        </pre>
      )}
    </div>
  );
}

export function UserMessage({ text, timestamp }: UserMessageProps) {
  const { textPart, images, terminalBlocks } = splitContent(text);
  const hasText = textPart.length > 0;
  const hasImages = images.length > 0;
  const hasTerminal = terminalBlocks.length > 0;

  return (
    <div className="flex max-w-[80%] flex-col items-end gap-1.5 self-end">
      {hasTerminal && (
        <div className="flex w-full flex-col gap-1.5">
          {terminalBlocks.map((block, i) => (
            <TerminalAttachment key={i} block={block} />
          ))}
        </div>
      )}
      {hasText && (
        <div className="rounded-2xl rounded-br-sm border border-border/50 bg-user-bg p-2 text-sm leading-relaxed text-user-text">
          <MarkdownContent text={textPart} />
        </div>
      )}
      {hasImages && <ImageRow images={images} />}
      {timestamp && (
        <span className="px-1 text-[10px] text-muted/45">{formatTimestamp(timestamp)}</span>
      )}
    </div>
  );
}
