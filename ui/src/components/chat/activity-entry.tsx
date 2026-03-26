import { useState } from "react";
import { ChevronRight, Brain, ShieldAlert, CircleX, CircleCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { UserInputAnswer } from "@shared/types";
import type { ActivityKind, Resolution, ResultStatus } from "@/components/chat/types";
import { getToolIcon } from "@/components/chat/shared";
import { escapeHtml, getCollapsedDetail } from "@/lib/utils";
import { ToolContent } from "@/components/chat/tool-content";
import { PermissionDeniedContent } from "@/components/chat/tool-content";

interface ActivityEntryProps {
  activity: ActivityKind;
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
  resolution?: Resolution;
  /** Merged result status from the paired tool_result. */
  resultStatus?: ResultStatus;
}

function ActivityIcon({
  activity,
  tool,
  resultStatus,
  isPermDenied,
}: {
  activity: ActivityKind;
  tool?: string;
  resultStatus?: ResultStatus;
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
    Icon = getToolIcon(tool);
    colorClass = "text-error/50";
  } else if (resultStatus === "success") {
    Icon = getToolIcon(tool);
    colorClass = "text-accent/40";
  } else {
    Icon = getToolIcon(tool);
    colorClass = "text-muted/35";
  }

  return <Icon size={12} className={`mt-[3px] shrink-0 ${colorClass}`} />;
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
          <ChevronRight
            size={10}
            className={`mt-[5px] shrink-0 text-muted/40 transition-transform ${
              expanded ? "rotate-90" : "opacity-0"
            }`}
          />
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
