import { useState } from "react";
import { escapeHtml, getCollapsedDetail } from "../../lib/utils";
import { MarkdownContent } from "./MarkdownContent";

interface ActivityEntryProps {
  activity: "tool_use" | "tool_result" | "thinking";
  description: string;
  tool?: string;
  detail?: string;
  input?: Record<string, unknown>;
  collapsed?: boolean;
  onSendMessage?: (text: string) => void;
  isInteractive?: boolean;
  permissionDenied?: string;
  onApproveTool?: (tool: string) => void;
  approvedTools?: Set<string>;
}

const iconMap = {
  tool_use: { icon: "\u26A1", cls: "bg-tool-use-bg text-tool-use-text" },
  tool_result: { icon: "\u2713", cls: "bg-accent-dim text-accent" },
  thinking: { icon: "\uD83D\uDCAD", cls: "bg-claude-dim text-claude" },
} as const;

function DiffView({ oldStr, newStr, filePath }: { oldStr: string; newStr: string; filePath?: string }) {
  const oldLines = oldStr.split("\n");
  const newLines = newStr.split("\n");

  return (
    <div className="mt-1.5 overflow-hidden rounded border border-border text-[0.625rem] leading-relaxed">
      {filePath && (
        <div className="border-b border-border bg-panel-header px-2.5 py-1 font-mono text-[0.6rem] text-muted">
          {filePath}
        </div>
      )}
      <div className="overflow-x-auto">
        {oldLines.map((line, i) => (
          <div key={`old-${i}`} className="whitespace-pre bg-diff-remove-bg px-2.5 text-error">
            <span className="mr-2 inline-block w-3 select-none opacity-60">-</span>
            {line || " "}
          </div>
        ))}
        {newLines.map((line, i) => (
          <div key={`new-${i}`} className="whitespace-pre bg-diff-add-bg px-2.5 text-accent">
            <span className="mr-2 inline-block w-3 select-none opacity-60">+</span>
            {line || " "}
          </div>
        ))}
      </div>
    </div>
  );
}

function CodeBlock({ content, label }: { content: string; label?: string }) {
  return (
    <div className="mt-1.5 overflow-hidden rounded border border-border text-[0.625rem] leading-relaxed">
      {label && (
        <div className="border-b border-border bg-panel-header px-2.5 py-1 font-mono text-[0.6rem] text-muted">
          {label}
        </div>
      )}
      <pre className="m-0 overflow-x-auto bg-panel-content px-2.5 py-1.5 font-mono text-[0.625rem] leading-relaxed text-text">
        {content}
      </pre>
    </div>
  );
}

const MAX_CONTENT_LINES = 80;

function truncateContent(text: string): string {
  const lines = text.split("\n");
  if (lines.length <= MAX_CONTENT_LINES) return text;
  return lines.slice(0, MAX_CONTENT_LINES).join("\n") + `\n... (${lines.length - MAX_CONTENT_LINES} more lines)`;
}

function AskUserQuestionContent({
  input,
  onSendMessage,
  isInteractive,
}: {
  input: Record<string, unknown>;
  onSendMessage?: (text: string) => void;
  isInteractive?: boolean;
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const questions = input.questions as Array<{
    question?: string;
    header?: string;
    options?: Array<{ label?: string; description?: string }>;
    multiSelect?: boolean;
  }> | undefined;

  if (!questions?.length) return null;

  const canClick = isInteractive && !!onSendMessage && selectedKey === null;

  return (
    <div className="mt-1.5 flex flex-col gap-2">
      {questions.map((q, qi) => (
        <div key={qi} className="overflow-hidden rounded border border-border">
          <div className="border-b border-border bg-panel-header px-2.5 py-1.5 text-[0.6875rem] font-medium text-text">
            {q.header && <span className="mr-2 rounded bg-claude-dim px-1.5 py-0.5 text-[0.6rem] text-claude">{q.header}</span>}
            {q.question}
          </div>
          {q.options && (
            <div className="flex flex-col gap-px bg-panel-options">
              {q.options.map((opt, oi) => {
                const key = `${qi}-${oi}`;
                const isSelected = selectedKey === key;
                const isDimmed = selectedKey !== null && !isSelected;
                return (
                  <div
                    key={oi}
                    className={`flex items-baseline gap-2 px-2.5 py-1.5 transition-all ${
                      canClick
                        ? "cursor-pointer rounded hover:bg-accent/10"
                        : ""
                    } ${isDimmed ? "opacity-40" : ""} ${
                      isSelected ? "bg-accent/10" : ""
                    }`}
                    onClick={
                      canClick && opt.label
                        ? () => {
                            setSelectedKey(key);
                            onSendMessage!(opt.label!);
                          }
                        : undefined
                    }
                  >
                    <span className="text-[0.6rem] tabular-nums text-muted">{oi + 1}.</span>
                    <span className={`text-[0.625rem] font-medium ${isSelected ? "text-accent" : "text-text"}`}>{opt.label}</span>
                    {opt.description && (
                      <span className="text-[0.6rem] text-muted">{opt.description}</span>
                    )}
                    {isSelected && (
                      <span className="ml-auto rounded bg-accent/20 px-1.5 py-0.5 text-[0.5rem] font-medium text-accent">sent</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function PermissionDeniedContent({
  tool,
  onApproveTool,
  isInteractive,
  approvedTools,
}: {
  tool: string;
  onApproveTool?: (tool: string) => void;
  isInteractive?: boolean;
  approvedTools?: Set<string>;
}) {
  const [approved, setApproved] = useState(false);
  const alreadyApproved = approvedTools?.has(tool) ?? false;
  const canClick = isInteractive && !!onApproveTool && !approved && !alreadyApproved;

  return (
    <div className="mt-1.5 flex items-center gap-2">
      {canClick ? (
        <button
          onClick={() => {
            setApproved(true);
            onApproveTool!(tool);
          }}
          className="rounded border border-warning/30 bg-warning/10 px-2.5 py-1 text-[0.6875rem] font-medium text-warning transition-colors hover:border-warning/50 hover:bg-warning/20"
        >
          Allow {tool}
        </button>
      ) : (approved || alreadyApproved) ? (
        <span className="flex items-center gap-1.5 text-[0.6875rem] text-accent">
          <span className="rounded bg-accent/20 px-1.5 py-0.5 text-[0.6rem] font-medium">Allowed</span>
        </span>
      ) : null}
    </div>
  );
}

function ToolContent({
  tool,
  input,
  onSendMessage,
  isInteractive,
}: {
  tool: string;
  input: Record<string, unknown>;
  onSendMessage?: (text: string) => void;
  isInteractive?: boolean;
}) {
  switch (tool) {
    case "Edit": {
      const oldStr = input.old_string as string | undefined;
      const newStr = input.new_string as string | undefined;
      const filePath = (input.file_path as string) || undefined;
      if (oldStr != null && newStr != null) {
        return <DiffView oldStr={oldStr} newStr={newStr} filePath={filePath} />;
      }
      return null;
    }
    case "Write": {
      const content = input.content as string | undefined;
      const filePath = (input.file_path as string) || undefined;
      if (content) {
        return <CodeBlock content={truncateContent(content)} label={filePath} />;
      }
      return null;
    }
    case "Bash": {
      const command = input.command as string | undefined;
      if (command) {
        return <CodeBlock content={command} label={input.description as string | undefined} />;
      }
      return null;
    }
    case "Read": {
      const filePath = (input.file_path as string) || undefined;
      if (filePath) {
        const parts = [];
        if (input.offset) parts.push(`offset: ${input.offset}`);
        if (input.limit) parts.push(`limit: ${input.limit}`);
        const extra = parts.length > 0 ? ` (${parts.join(", ")})` : "";
        return <CodeBlock content={filePath + extra} />;
      }
      return null;
    }
    case "Grep": {
      const pattern = input.pattern as string | undefined;
      if (pattern) {
        const parts = [`pattern: ${pattern}`];
        if (input.path) parts.push(`path: ${input.path}`);
        if (input.glob) parts.push(`glob: ${input.glob}`);
        return <CodeBlock content={parts.join("\n")} />;
      }
      return null;
    }
    case "Glob": {
      const pattern = input.pattern as string | undefined;
      if (pattern) {
        const parts = [`pattern: ${pattern}`];
        if (input.path) parts.push(`path: ${input.path}`);
        return <CodeBlock content={parts.join("\n")} />;
      }
      return null;
    }
    case "ExitPlanMode": {
      const plan = input.plan as string | undefined;
      if (plan) {
        return (
          <div className="mt-1.5 overflow-hidden rounded border border-border bg-panel-content p-3 text-[0.75rem]">
            <MarkdownContent text={plan} />
          </div>
        );
      }
      return null;
    }
    case "AskUserQuestion":
      return <AskUserQuestionContent input={input} onSendMessage={onSendMessage} isInteractive={isInteractive} />;
    default:
      return null;
  }
}

export function ActivityEntry({
  activity,
  description,
  tool,
  detail,
  input,
  collapsed,
  onSendMessage,
  isInteractive,
  permissionDenied,
  onApproveTool,
  approvedTools,
}: ActivityEntryProps) {
  const hasRichContent = !!input && !!tool;
  const isPermDenied = !!permissionDenied;
  const defaultExpanded = isPermDenied || (hasRichContent && (tool === "Edit" || tool === "ExitPlanMode" || tool === "AskUserQuestion" || tool === "Write"));
  const [expanded, setExpanded] = useState(defaultExpanded);

  const info = isPermDenied
    ? { icon: "\uD83D\uDD12", cls: "bg-warning/10 text-warning" }
    : iconMap[activity] || iconMap.tool_use;
  const isError = description === "Tool error";
  const collapsedText = detail ? getCollapsedDetail(detail, tool) : "";
  const isExpandable = isPermDenied || hasRichContent || (!!detail && collapsedText !== detail);

  return (
    <div
      className={`flex flex-col ${collapsed ? "hidden" : ""}`}
    >
      <div
        className={`flex items-center gap-2 px-2.5 py-0.5 text-[0.6875rem] leading-snug text-muted ${
          isError ? "rounded bg-error-dim" : ""
        } ${
          isExpandable ? "cursor-pointer rounded transition-colors hover:bg-hover-highlight" : ""
        }`}
        onClick={isExpandable ? () => setExpanded(!expanded) : undefined}
      >
        <div
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded text-[0.5625rem] ${info.cls}`}
        >
          {info.icon}
        </div>
        <div
          className={`flex min-w-0 flex-1 items-baseline gap-1.5 ${
            expanded && !hasRichContent ? "flex-wrap" : ""
          }`}
        >
          <span
            className={`whitespace-nowrap text-[0.6875rem] font-medium ${
              isError ? "text-error" : "text-text"
            }`}
          >
            {description}
          </span>
          {tool && (
            <span className="text-[0.6875rem] font-normal opacity-50">
              {tool}
            </span>
          )}
          {detail && !expanded && (
            <div
              className="overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[0.625rem] text-muted"
              dangerouslySetInnerHTML={{
                __html: escapeHtml(collapsedText),
              }}
            />
          )}
          {detail && expanded && !hasRichContent && (
            <div
              className="basis-full whitespace-pre-wrap break-words pt-0.5 pb-0.5 font-mono text-[0.625rem] text-muted opacity-80"
              dangerouslySetInnerHTML={{
                __html: escapeHtml(detail),
              }}
            />
          )}
        </div>
        {isExpandable && (
          <span
            className={`flex h-3 w-3 shrink-0 items-center justify-center text-[0.5rem] text-muted transition-transform ${
              expanded ? "rotate-90 opacity-50" : "opacity-0"
            } ${isExpandable ? "group-hover:opacity-50" : ""}`}
          >
            &#9654;
          </span>
        )}
      </div>
      {expanded && hasRichContent && (
        <div className="px-2.5 pb-1.5">
          <ToolContent tool={tool!} input={input!} onSendMessage={onSendMessage} isInteractive={isInteractive} />
        </div>
      )}
      {expanded && isPermDenied && (
        <div className="px-2.5 pb-1.5">
          <PermissionDeniedContent tool={permissionDenied!} onApproveTool={onApproveTool} isInteractive={isInteractive} approvedTools={approvedTools} />
        </div>
      )}
    </div>
  );
}
