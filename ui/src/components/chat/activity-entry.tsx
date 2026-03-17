import { useState } from "react";
import type { UserInputAnswer } from "@shared/types";
import { escapeHtml, getCollapsedDetail } from "../../lib/utils";
import { MarkdownContent } from "./markdown-content";
import { DiffView, ActivityCodeBlock, langFromPath, truncateContent } from "./activity-code";
import {
  Terminal,
  FileText,
  Pencil,
  FilePlus,
  FolderSearch,
  Search,
  Globe,
  GitBranch,
  MessageCircleQuestion,
  ClipboardCheck,
  ClipboardList,
  BookOpen,
  Send,
  UserPlus,
  UserMinus,
  Brain,
  Wrench,
  ShieldAlert,
  CircleX,
  CircleCheck,
  type LucideIcon,
} from "lucide-react";

interface ActivityEntryProps {
  activity: "tool_use" | "tool_result" | "thinking" | "task_list" | "file_list";
  description: string;
  tool?: string;
  detail?: string;
  input?: Record<string, unknown>;
  inputDescription?: string;
  collapsed?: boolean;
  onSendMessage?: (text: string) => void;
  onAnswerUserInput?: (requestId: string, answers: Record<string, UserInputAnswer>) => void;
  isInteractive?: boolean;
  permissionDenied?: string;
  onApproveTool?: (tool: string) => void;
  approvedTools?: Set<string>;
  isExternalPending?: boolean;
  resolution?: "approved" | "dismissed" | "feedback";
  planChildId?: string;
  planChildName?: string;
  /** Merged result status from the paired tool_result. */
  resultStatus?: "success" | "error";
}

const TOOL_ICONS: Record<string, LucideIcon> = {
  Bash: Terminal,
  Read: FileText,
  Edit: Pencil,
  Write: FilePlus,
  Glob: FolderSearch,
  Grep: Search,
  WebFetch: Globe,
  WebSearch: Globe,
  Task: GitBranch,
  AskUserQuestion: MessageCircleQuestion,
  ExitPlanMode: ClipboardCheck,
  EnterPlanMode: ClipboardList,
  NotebookEdit: BookOpen,
  SendMessage: Send,
  TeamCreate: UserPlus,
  TeamDelete: UserMinus,
};

function ActivityIcon({
  activity,
  tool,
  resultStatus,
  isPermDenied,
}: {
  activity: ActivityEntryProps["activity"];
  tool?: string;
  resultStatus?: "success" | "error";
  isPermDenied?: boolean;
}) {
  let Icon: LucideIcon;
  let colorClass: string;

  if (isPermDenied) {
    Icon = ShieldAlert;
    colorClass = "text-warning/50";
  } else if (activity === "tool_result") {
    Icon = resultStatus === "error" ? CircleX : CircleCheck;
    colorClass = resultStatus === "error" ? "text-error/50" : "text-accent/40";
  } else if (activity === "thinking") {
    Icon = Brain;
    colorClass = "text-claude/40";
  } else if (resultStatus === "error") {
    Icon = (tool && TOOL_ICONS[tool]) || Wrench;
    colorClass = "text-error/50";
  } else if (resultStatus === "success") {
    Icon = (tool && TOOL_ICONS[tool]) || Wrench;
    colorClass = "text-accent/40";
  } else {
    Icon = (tool && TOOL_ICONS[tool]) || Wrench;
    colorClass = "text-muted/35";
  }

  return <Icon size={12} className={`mt-[3px] shrink-0 ${colorClass}`} />;
}

function AskUserQuestionContent({
  input,
  onSendMessage,
  onAnswerUserInput,
  isInteractive,
}: {
  input: Record<string, unknown>;
  onSendMessage?: (text: string) => void;
  onAnswerUserInput?: (requestId: string, answers: Record<string, UserInputAnswer>) => void;
  isInteractive?: boolean;
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, string>>({});
  const [otherAnswers, setOtherAnswers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const requestId = typeof input.requestId === "string" ? input.requestId : null;
  const questions = input.questions as
    | Array<{
        id?: string;
        question?: string;
        header?: string;
        options?: Array<{ label?: string; description?: string }>;
        isOther?: boolean;
      }>
    | undefined;

  if (!questions?.length) return null;

  const isManagedPrompt = !!requestId && !!onAnswerUserInput;
  const canClick = isInteractive && !!onSendMessage && !isManagedPrompt && selectedKey === null;
  const canRespond = isInteractive && isManagedPrompt && !submitted;

  const answerForQuestion = (questionId: string) => {
    if (selectedAnswers[questionId] === "__other__") {
      const other = otherAnswers[questionId]?.trim();
      return other ? [other] : [];
    }
    const selected = selectedAnswers[questionId];
    return selected ? [selected] : [];
  };

  const canSubmit =
    canRespond &&
    questions.every((question, index) => {
      const questionId = question.id || `question-${index}`;
      return answerForQuestion(questionId).length > 0;
    });

  return (
    <div className="mt-2 flex flex-col gap-2">
      {questions.map((q, qi) => {
        const questionId = q.id || `question-${qi}`;
        const selectedAnswer = selectedAnswers[questionId];
        const showOther = q.isOther && selectedAnswer === "__other__";

        return (
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
                  const isSelected = isManagedPrompt
                    ? selectedAnswer === opt.label
                    : selectedKey === key;
                  const isDimmed = !isManagedPrompt && selectedKey !== null && !isSelected;
                  return (
                    <div
                      key={oi}
                      className={`flex items-baseline gap-2.5 border-b border-border px-3 py-2 transition-all last:border-b-0 ${
                        canClick || canRespond ? "cursor-pointer hover:bg-accent/5" : ""
                      } ${isDimmed ? "opacity-35" : ""} ${isSelected ? "bg-accent/5" : ""}`}
                      onClick={
                        opt.label
                          ? () => {
                              if (canClick) {
                                setSelectedKey(key);
                                setSubmitted(true);
                                onSendMessage!(opt.label);
                                return;
                              }
                              if (canRespond) {
                                setSelectedAnswers((prev) => ({
                                  ...prev,
                                  [questionId]: opt.label!,
                                }));
                              }
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
                      {isSelected && !isManagedPrompt && (
                        <span className="ml-auto rounded-md bg-accent/15 px-2 py-0.5 text-[0.6875rem] font-medium text-accent">
                          sent
                        </span>
                      )}
                    </div>
                  );
                })}
                {q.isOther && (
                  <div className="border-b border-border px-3 py-2 last:border-b-0">
                    <button
                      type="button"
                      className={`rounded-md px-2 py-1 text-[0.75rem] font-medium transition-colors ${
                        selectedAnswer === "__other__"
                          ? "bg-accent/10 text-accent"
                          : "text-muted hover:bg-accent/5 hover:text-text"
                      }`}
                      onClick={
                        canRespond
                          ? () =>
                              setSelectedAnswers((prev) => ({
                                ...prev,
                                [questionId]: "__other__",
                              }))
                          : undefined
                      }
                    >
                      Other
                    </button>
                    {showOther && (
                      <input
                        type="text"
                        value={otherAnswers[questionId] ?? ""}
                        onChange={(e) =>
                          setOtherAnswers((prev) => ({
                            ...prev,
                            [questionId]: e.target.value,
                          }))
                        }
                        placeholder="Type your answer"
                        className="mt-2 w-full rounded-lg border border-border bg-bg px-3 py-2 text-[0.8125rem] text-text placeholder:text-muted focus:border-accent focus:ring-1 focus:ring-accent-dim focus:outline-none"
                      />
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
      {isManagedPrompt && (canRespond || submitted) && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => {
              if (!requestId || !onAnswerUserInput) return;
              const answers = Object.fromEntries(
                questions.map((question, index) => {
                  const questionId = question.id || `question-${index}`;
                  return [questionId, { answers: answerForQuestion(questionId) }];
                }),
              ) as Record<string, UserInputAnswer>;
              setSubmitted(true);
              onAnswerUserInput(requestId, answers);
            }}
            className="rounded-lg bg-accent/10 px-3.5 py-1.5 text-[0.8125rem] font-medium text-accent transition-colors hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-30"
          >
            Submit
          </button>
          <button
            type="button"
            disabled={!canRespond}
            onClick={() => {
              if (!requestId || !onAnswerUserInput) return;
              setSubmitted(true);
              onAnswerUserInput(requestId, {});
            }}
            className="rounded-lg px-3.5 py-1.5 text-[0.8125rem] font-medium text-muted transition-colors hover:bg-surface-hover hover:text-text disabled:cursor-not-allowed disabled:opacity-30"
          >
            Dismiss
          </button>
          {submitted && (
            <span className="rounded-md bg-accent/15 px-2 py-0.5 text-[0.6875rem] font-medium text-accent">
              sent
            </span>
          )}
        </div>
      )}
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

function ToolContent({
  tool,
  input,
  onSendMessage,
  onAnswerUserInput,
  isInteractive,
  resolution,
  planChildId,
  planChildName,
}: {
  tool: string;
  input: Record<string, unknown>;
  onSendMessage?: (text: string) => void;
  onAnswerUserInput?: (requestId: string, answers: Record<string, UserInputAnswer>) => void;
  isInteractive?: boolean;
  resolution?: "approved" | "dismissed" | "feedback";
  planChildId?: string;
  planChildName?: string;
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
      // Plan content is shown in the dedicated plan review UI, not inline.
      // Just show the resolution badge if the plan was already reviewed.
      return (
        <div className="mt-1.5">
          {resolution === "approved" && (
            <span className="inline-block w-fit rounded-md bg-accent/15 px-2 py-0.5 text-[0.75rem] font-medium text-accent">
              Approved
            </span>
          )}
          {(resolution === "feedback" || resolution === "dismissed") && (
            <span className="inline-block w-fit rounded-md bg-warning/15 px-2 py-0.5 text-[0.75rem] font-medium text-warning">
              {resolution === "dismissed" ? "Dismissed" : "Changes requested"}
            </span>
          )}
        </div>
      );
    }
    case "AskUserQuestion":
      return (
        <AskUserQuestionContent
          input={input}
          onSendMessage={onSendMessage}
          onAnswerUserInput={onAnswerUserInput}
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
  onAnswerUserInput,
  isInteractive,
  permissionDenied,
  onApproveTool,
  approvedTools,
  isExternalPending,
  resolution,
  planChildId,
  planChildName,
  resultStatus,
}: ActivityEntryProps) {
  const hasRichContent = !!input && !!tool;
  const isPermDenied = !!permissionDenied;
  const defaultExpanded =
    isPermDenied ||
    (hasRichContent && (tool === "Edit" || tool === "AskUserQuestion" || tool === "Write"));
  const [expanded, setExpanded] = useState(defaultExpanded);

  const isError = description === "Tool error";
  const collapsedText = detail ? getCollapsedDetail(detail, tool) : "";
  const detailTruncated = !!detail && collapsedText !== detail;
  // Only expandable if expanding reveals content not already visible in the collapsed row.
  // Edit/Write show diffs/full content; AskUserQuestion/ExitPlanMode have interactive UI.
  // Other tools (Bash, Read, Grep, Glob) just re-render the same text as a code block —
  // only worth expanding if the detail was truncated.
  const RICH_EXPAND_TOOLS = new Set(["Edit", "Write", "AskUserQuestion", "ExitPlanMode"]);
  const richExpandable = hasRichContent && (RICH_EXPAND_TOOLS.has(tool!) || detailTruncated);
  const isExpandable = isPermDenied || richExpandable || detailTruncated;

  return (
    <div className={`flex flex-col ${collapsed ? "hidden" : ""}`}>
      <div
        className={`flex items-start gap-2.5 rounded-md px-2 py-1 text-[11px] leading-relaxed text-muted ${
          isError ? "bg-error-dim" : ""
        } ${isExpandable ? "cursor-pointer transition-colors duration-150 hover:bg-hover-highlight" : ""}`}
        onClick={isExpandable ? () => setExpanded(!expanded) : undefined}
      >
        <ActivityIcon
          activity={activity}
          tool={tool}
          resultStatus={resultStatus}
          isPermDenied={isPermDenied}
        />
        <div
          className={`flex min-w-0 flex-1 items-baseline gap-1.5 ${
            expanded && !hasRichContent ? "flex-wrap" : ""
          }`}
        >
          <span
            className={`whitespace-nowrap text-[11px] ${
              isError
                ? "font-medium text-error"
                : activity === "tool_result"
                  ? "text-muted/70"
                  : "text-muted"
            }`}
          >
            {description}
          </span>
          {isExternalPending && (
            <span className="whitespace-nowrap rounded-md bg-claude-dim px-1.5 py-0.5 text-[10px] font-medium text-claude">
              Pending in terminal
            </span>
          )}
          {resultStatus === "error" && (
            <span className="whitespace-nowrap rounded-md bg-error-dim px-1.5 py-0.5 text-[10px] font-medium text-error">
              Failed
            </span>
          )}
          {!expanded && inputDescription && (
            <span className="truncate text-[11px] text-muted/50">{inputDescription}</span>
          )}
          {!expanded && detail && !inputDescription && (
            <div
              className="overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[11px] text-muted/50"
              dangerouslySetInnerHTML={{
                __html: escapeHtml(collapsedText),
              }}
            />
          )}
          {expanded && detail && !hasRichContent && (
            <div
              className="basis-full whitespace-pre-wrap break-words pt-0.5 pb-0.5 font-mono text-[11px] text-muted/60"
              dangerouslySetInnerHTML={{
                __html: escapeHtml(detail),
              }}
            />
          )}
        </div>
        {isExpandable && (
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`mt-[5px] shrink-0 text-muted/40 transition-transform ${
              expanded ? "rotate-90" : "opacity-0"
            }`}
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        )}
      </div>
      {expanded && hasRichContent && (
        <div className="pl-[18px] pr-2 pb-1.5">
          <ToolContent
            tool={tool!}
            input={input!}
            onSendMessage={onSendMessage}
            onAnswerUserInput={onAnswerUserInput}
            isInteractive={isInteractive}
            resolution={resolution}
            planChildId={planChildId}
            planChildName={planChildName}
          />
        </div>
      )}
      {expanded && isPermDenied && (
        <div className="pl-[18px] pr-2 pb-1.5">
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
