import { useState } from "react";
import { escapeHtml, getCollapsedDetail } from "../../lib/utils";
import hljs from "../../lib/markdown";
import { MarkdownContent } from "./markdown-content";

const EXT_TO_LANG: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  py: "python",
  sh: "bash",
  bash: "bash",
  json: "json",
  css: "css",
  html: "html",
  xml: "xml",
  svg: "xml",
};

function langFromPath(filePath?: string): string | undefined {
  if (!filePath) return undefined;
  const ext = filePath.split(".").pop()?.toLowerCase();
  return ext ? EXT_TO_LANG[ext] : undefined;
}

function highlightCode(code: string, lang?: string): string | undefined {
  if (!lang || !hljs.getLanguage(lang)) return undefined;
  try {
    return hljs.highlight(code, { language: lang }).value;
  } catch {
    return undefined;
  }
}

interface ActivityEntryProps {
  activity: "tool_use" | "tool_result" | "thinking" | "task_list";
  description: string;
  tool?: string;
  detail?: string;
  input?: Record<string, unknown>;
  inputDescription?: string;
  collapsed?: boolean;
  onSendMessage?: (text: string) => void;
  isInteractive?: boolean;
  permissionDenied?: string;
  onApproveTool?: (tool: string) => void;
  approvedTools?: Set<string>;
  isExternalPending?: boolean;
}

function ActivityIcon({ type }: { type: "tool_use" | "tool_result" | "thinking" | "task_list" }) {
  switch (type) {
    case "tool_use":
      return (
        <div className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded bg-tool-use-bg text-tool-use-text">
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
        </div>
      );
    case "tool_result":
      return (
        <div className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded bg-accent-dim text-accent">
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
      );
    case "thinking":
      return (
        <div className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded bg-claude-dim text-claude">
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="1" />
            <circle cx="19" cy="12" r="1" />
            <circle cx="5" cy="12" r="1" />
          </svg>
        </div>
      );
  }
}

function PermissionIcon() {
  return (
    <div className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded bg-warning/10 text-warning">
      <svg
        width="10"
        height="10"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    </div>
  );
}

function DiffView({
  oldStr,
  newStr,
  filePath,
  lang,
}: {
  oldStr: string;
  newStr: string;
  filePath?: string;
  lang?: string;
}) {
  const oldHighlighted = highlightCode(oldStr, lang);
  const newHighlighted = highlightCode(newStr, lang);
  const oldLines = (oldHighlighted ?? escapeHtml(oldStr)).split("\n");
  const newLines = (newHighlighted ?? escapeHtml(newStr)).split("\n");

  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-border text-[0.75rem] leading-relaxed">
      {filePath && (
        <div className="border-b border-border bg-panel-header px-3 py-1.5 font-mono text-[0.6875rem] text-muted">
          {filePath}
        </div>
      )}
      <div className="overflow-x-auto">
        {oldLines.map((line, i) => (
          <div
            key={`old-${i}`}
            className="whitespace-pre bg-diff-remove-bg px-3 py-px font-mono text-[0.75rem] text-error"
          >
            <span className="mr-2 inline-block w-3 select-none opacity-50">-</span>
            <span dangerouslySetInnerHTML={{ __html: line || " " }} />
          </div>
        ))}
        {newLines.map((line, i) => (
          <div
            key={`new-${i}`}
            className="whitespace-pre bg-diff-add-bg px-3 py-px font-mono text-[0.75rem] text-accent"
          >
            <span className="mr-2 inline-block w-3 select-none opacity-50">+</span>
            <span dangerouslySetInnerHTML={{ __html: line || " " }} />
          </div>
        ))}
      </div>
    </div>
  );
}

function ActivityCodeBlock({
  content,
  label,
  lang,
}: {
  content: string;
  label?: string;
  lang?: string;
}) {
  const highlighted = highlightCode(content, lang);
  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-border text-[0.75rem] leading-relaxed">
      {label && (
        <div className="border-b border-border bg-panel-header px-3 py-1.5 font-mono text-[0.6875rem] text-muted">
          {label}
        </div>
      )}
      {highlighted ? (
        <pre
          className="hljs m-0 overflow-x-auto bg-panel-content px-3 py-2 font-mono text-[0.75rem] leading-relaxed"
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
      ) : (
        <pre className="m-0 overflow-x-auto bg-panel-content px-3 py-2 font-mono text-[0.75rem] leading-relaxed text-text">
          {content}
        </pre>
      )}
    </div>
  );
}

const MAX_CONTENT_LINES = 80;

function truncateContent(text: string): string {
  const lines = text.split("\n");
  if (lines.length <= MAX_CONTENT_LINES) return text;
  return (
    lines.slice(0, MAX_CONTENT_LINES).join("\n") +
    `\n... (${lines.length - MAX_CONTENT_LINES} more lines)`
  );
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
  const questions = input.questions as
    | Array<{
        question?: string;
        header?: string;
        options?: Array<{ label?: string; description?: string }>;
        multiSelect?: boolean;
      }>
    | undefined;

  if (!questions?.length) return null;

  const canClick = isInteractive && !!onSendMessage && selectedKey === null;

  return (
    <div className="mt-2 flex flex-col gap-2">
      {questions.map((q, qi) => (
        <div key={qi} className="overflow-hidden rounded-lg border border-border">
          <div className="border-b border-border bg-panel-header px-3 py-2 text-[0.8125rem] font-medium text-text">
            {q.header && (
              <span className="mr-2 rounded-md bg-claude-dim px-2 py-0.5 text-[0.6875rem] font-medium text-claude">
                {q.header}
              </span>
            )}
            {q.question}
          </div>
          {q.options && (
            <div className="flex flex-col">
              {q.options.map((opt, oi) => {
                const key = `${qi}-${oi}`;
                const isSelected = selectedKey === key;
                const isDimmed = selectedKey !== null && !isSelected;
                return (
                  <div
                    key={oi}
                    className={`flex items-baseline gap-2.5 border-b border-border px-3 py-2 transition-all last:border-b-0 ${
                      canClick ? "cursor-pointer hover:bg-accent/5" : ""
                    } ${isDimmed ? "opacity-35" : ""} ${isSelected ? "bg-accent/5" : ""}`}
                    onClick={
                      canClick && opt.label
                        ? () => {
                            setSelectedKey(key);
                            onSendMessage!(opt.label!);
                          }
                        : undefined
                    }
                  >
                    <span className="text-[0.75rem] tabular-nums text-muted/60">{oi + 1}.</span>
                    <span
                      className={`text-[0.8125rem] font-medium ${isSelected ? "text-accent" : "text-text"}`}
                    >
                      {opt.label}
                    </span>
                    {opt.description && (
                      <span className="text-[0.75rem] text-muted">{opt.description}</span>
                    )}
                    {isSelected && (
                      <span className="ml-auto rounded-md bg-accent/15 px-2 py-0.5 text-[0.6875rem] font-medium text-accent">
                        sent
                      </span>
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
    <div className="mt-2 flex items-center gap-2">
      {canClick ? (
        <button
          onClick={() => {
            setApproved(true);
            onApproveTool!(tool);
          }}
          className="rounded-lg border border-warning/25 bg-warning/10 px-3 py-1.5 text-[0.8125rem] font-medium text-warning transition-colors hover:border-warning/40 hover:bg-warning/15"
        >
          Allow {tool}
        </button>
      ) : approved || alreadyApproved ? (
        <span className="rounded-md bg-accent/15 px-2 py-0.5 text-[0.75rem] font-medium text-accent">
          Allowed
        </span>
      ) : null}
    </div>
  );
}

function PlanApprovalContent({
  plan,
  onSendMessage,
  isInteractive,
}: {
  plan: string;
  onSendMessage?: (text: string) => void;
  isInteractive?: boolean;
}) {
  const [state, setState] = useState<"pending" | "approved" | "editing" | "sent">("pending");
  const [feedback, setFeedback] = useState("");
  const canAct = isInteractive && !!onSendMessage && state === "pending";

  return (
    <>
      <div className="mt-2 overflow-hidden rounded-lg border border-border bg-panel-content p-4 text-[0.8125rem]">
        <MarkdownContent text={plan} />
      </div>
      <div className="mt-2.5 flex flex-col gap-2">
        {(state === "pending" || state === "editing") && (
          <div className="flex items-center gap-2">
            {canAct && (
              <button
                onClick={() => {
                  setState("approved");
                  onSendMessage!("Yes, go ahead with this plan.");
                }}
                className="rounded-lg bg-accent/10 px-3.5 py-1.5 text-[0.8125rem] font-medium text-accent transition-colors hover:bg-accent/15"
              >
                Approve Plan
              </button>
            )}
            {canAct && state !== "editing" && (
              <button
                onClick={() => setState("editing")}
                className="rounded-lg px-3.5 py-1.5 text-[0.8125rem] font-medium text-muted transition-colors hover:bg-surface-hover hover:text-warning"
              >
                Request Changes
              </button>
            )}
          </div>
        )}
        {state === "editing" && (
          <div className="flex gap-2">
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="Describe what to change..."
              rows={2}
              autoFocus
              className="flex-1 resize-none rounded-lg border border-border bg-bg px-3 py-2 text-[0.8125rem] text-text placeholder:text-muted focus:border-accent focus:ring-1 focus:ring-accent-dim focus:outline-none"
            />
            <button
              onClick={() => {
                if (!feedback.trim()) return;
                setState("sent");
                onSendMessage!(feedback.trim());
              }}
              disabled={!feedback.trim()}
              className="self-end rounded-lg bg-warning/10 px-3.5 py-1.5 text-[0.8125rem] font-medium text-warning transition-colors hover:bg-warning/15 disabled:opacity-30"
            >
              Send
            </button>
          </div>
        )}
        {state === "approved" && (
          <span className="rounded-md bg-accent/15 px-2 py-0.5 text-[0.75rem] font-medium text-accent w-fit">
            Approved
          </span>
        )}
        {state === "sent" && (
          <span className="rounded-md bg-warning/15 px-2 py-0.5 text-[0.75rem] font-medium text-warning w-fit">
            Changes requested
          </span>
        )}
      </div>
    </>
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
        return (
          <DiffView
            oldStr={oldStr}
            newStr={newStr}
            filePath={filePath}
            lang={langFromPath(filePath)}
          />
        );
      }
      return null;
    }
    case "Write": {
      const content = input.content as string | undefined;
      const filePath = (input.file_path as string) || undefined;
      if (content) {
        return (
          <ActivityCodeBlock
            content={truncateContent(content)}
            label={filePath}
            lang={langFromPath(filePath)}
          />
        );
      }
      return null;
    }
    case "Bash": {
      const command = input.command as string | undefined;
      if (command) {
        return (
          <ActivityCodeBlock
            content={command}
            label={input.description as string | undefined}
            lang="bash"
          />
        );
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
        return <ActivityCodeBlock content={filePath + extra} />;
      }
      return null;
    }
    case "Grep": {
      const pattern = input.pattern as string | undefined;
      if (pattern) {
        const parts = [`pattern: ${pattern}`];
        if (input.path) parts.push(`path: ${input.path}`);
        if (input.glob) parts.push(`glob: ${input.glob}`);
        return <ActivityCodeBlock content={parts.join("\n")} />;
      }
      return null;
    }
    case "Glob": {
      const pattern = input.pattern as string | undefined;
      if (pattern) {
        const parts = [`pattern: ${pattern}`];
        if (input.path) parts.push(`path: ${input.path}`);
        return <ActivityCodeBlock content={parts.join("\n")} />;
      }
      return null;
    }
    case "ExitPlanMode": {
      const plan = input.plan as string | undefined;
      if (plan) {
        return (
          <PlanApprovalContent
            plan={plan}
            onSendMessage={onSendMessage}
            isInteractive={isInteractive}
          />
        );
      }
      return null;
    }
    case "AskUserQuestion":
      return (
        <AskUserQuestionContent
          input={input}
          onSendMessage={onSendMessage}
          isInteractive={isInteractive}
        />
      );
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
  inputDescription,
  collapsed,
  onSendMessage,
  isInteractive,
  permissionDenied,
  onApproveTool,
  approvedTools,
  isExternalPending,
}: ActivityEntryProps) {
  const hasRichContent = !!input && !!tool;
  const isPermDenied = !!permissionDenied;
  const defaultExpanded =
    isPermDenied ||
    (hasRichContent &&
      (tool === "Edit" ||
        tool === "ExitPlanMode" ||
        tool === "AskUserQuestion" ||
        tool === "Write"));
  const [expanded, setExpanded] = useState(defaultExpanded);

  const isError = description === "Tool error";
  const collapsedText = detail ? getCollapsedDetail(detail, tool) : "";
  const isExpandable = isPermDenied || hasRichContent || (!!detail && collapsedText !== detail);

  return (
    <div className={`flex flex-col ${collapsed ? "hidden" : ""}`}>
      <div
        className={`flex items-start gap-2 rounded-md px-2.5 py-1 text-[0.8125rem] leading-snug text-muted ${
          isError ? "bg-error-dim" : ""
        } ${isExpandable ? "cursor-pointer transition-colors hover:bg-hover-highlight" : ""}`}
        onClick={isExpandable ? () => setExpanded(!expanded) : undefined}
      >
        {isPermDenied ? <PermissionIcon /> : <ActivityIcon type={activity} />}
        <div
          className={`flex min-w-0 flex-1 items-baseline gap-1.5 ${
            expanded && !hasRichContent ? "flex-wrap" : ""
          }`}
        >
          <span
            className={`whitespace-nowrap text-[0.8125rem] font-medium ${
              isError ? "text-error" : "text-text"
            }`}
          >
            {description}
          </span>
          {tool && <span className="text-[0.8125rem] font-normal text-muted/50">{tool}</span>}
          {isExternalPending && (
            <span className="whitespace-nowrap rounded-md bg-claude-dim px-1.5 py-0.5 text-[0.6875rem] font-medium text-claude">
              Pending in terminal
            </span>
          )}
          {inputDescription && (
            <span className="truncate text-[0.75rem] text-muted/60">{inputDescription}</span>
          )}
          {detail && !expanded && (
            <div
              className="overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[0.75rem] text-muted"
              dangerouslySetInnerHTML={{
                __html: escapeHtml(collapsedText),
              }}
            />
          )}
          {detail && expanded && !hasRichContent && (
            <div
              className="basis-full whitespace-pre-wrap break-words pt-0.5 pb-0.5 font-mono text-[0.75rem] text-muted/70"
              dangerouslySetInnerHTML={{
                __html: escapeHtml(detail),
              }}
            />
          )}
        </div>
        {isExpandable && (
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`shrink-0 text-muted transition-transform ${
              expanded ? "rotate-90 opacity-50" : "opacity-0"
            }`}
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        )}
      </div>
      {expanded && hasRichContent && (
        <div className="pl-[34px] pr-2.5 pb-2">
          <ToolContent
            tool={tool!}
            input={input!}
            onSendMessage={onSendMessage}
            isInteractive={isInteractive}
          />
        </div>
      )}
      {expanded && isPermDenied && (
        <div className="pl-[34px] pr-2.5 pb-2">
          <PermissionDeniedContent
            tool={permissionDenied!}
            onApproveTool={onApproveTool}
            isInteractive={isInteractive}
            approvedTools={approvedTools}
          />
        </div>
      )}
    </div>
  );
}
