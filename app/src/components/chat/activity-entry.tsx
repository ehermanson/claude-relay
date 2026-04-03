import { useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronRight, Brain, ShieldAlert, CircleX, CircleCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { UserInputAnswer } from "@shared/types";
import type { ActivityKind, Resolution, ResultStatus } from "@/lib/chat-types";
import { getToolIcon } from "@/lib/tool-icons";
import { ToolContent } from "@/components/chat/tool-content";
import { PermissionDeniedContent } from "@/components/chat/tool-content";

// Tools with rich input that's always worth seeing (diffs, file content, interactive UI).
const ALWAYS_EXPANDABLE = new Set(["Edit", "Write", "AskUserQuestion", "ExitPlanMode"]);

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
  /** Merged result detail from the paired tool_result. */
  resultDetail?: string;
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

/**
 * Compute a single clean display name for a tool call, following Kanna's pattern:
 * one descriptive string that communicates what happened, no secondary detail.
 */
function computeDisplayName(
  tool: string | undefined,
  description: string,
  detail: string | undefined,
  inputDescription: string | undefined,
): string {
  if (!tool || !detail) return description;
  switch (tool) {
    case "Bash":
      // Human description first, fall back to truncated command
      if (inputDescription) return inputDescription;
      return detail.length > 60 ? detail.slice(0, 60) + "\u2026" : detail;
    case "Edit":
    case "Write":
    case "Read": {
      const fileName = detail.split("/").pop() || detail;
      const verb = tool === "Edit" ? "Edit" : tool === "Write" ? "Write" : "Read";
      return `${verb} ${fileName}`;
    }
    case "Grep":
      return `Find \`${detail}\` in files`;
    case "Glob":
      return `Search files matching ${detail}`;
    default:
      return description;
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
  resultStatus,
  resultDetail,
}: ActivityEntryProps) {
  const hasRichContent = !!input && !!tool;
  const isPermDenied = !!permissionDenied;
  const defaultExpanded = isPermDenied || (hasRichContent && tool === "AskUserQuestion");
  const [expanded, setExpanded] = useState(defaultExpanded);
  // Lazy-mount: only render content once it's been expanded at least once,
  // so collapsed-by-default items don't pay the render cost.
  const hasBeenExpanded = useRef(defaultExpanded);
  if (expanded) hasBeenExpanded.current = true;

  const isError = description === "Tool error";
  const displayName = computeDisplayName(tool, description, detail, inputDescription);

  // Any completed tool (has resultStatus) is expandable to see input+output.
  const hasCompletedResult = !!resultStatus;
  const isExpandable =
    isPermDenied ||
    (hasRichContent && ALWAYS_EXPANDABLE.has(tool!)) ||
    (hasRichContent && hasCompletedResult) ||
    (hasRichContent && !!resultDetail);

  return (
    <div className={`flex flex-col ${collapsed ? "hidden" : ""}`}>
      <div
        className={`group/entry flex items-start gap-2.5 rounded-md py-1 text-[11px] leading-relaxed text-muted ${
          isError ? "bg-error-dim" : ""
        } ${isExpandable ? "cursor-pointer" : ""}`}
        onClick={isExpandable ? () => setExpanded(!expanded) : undefined}
      >
        <ActivityIcon
          activity={activity}
          tool={tool}
          resultStatus={resultStatus}
          isPermDenied={isPermDenied}
        />
        <span
          className={`min-w-0 truncate text-[11px] ${
            isError
              ? "font-medium text-error"
              : isExpandable
                ? "transition-colors duration-150 group-hover/entry:text-text-bright"
                : ""
          }`}
        >
          {displayName}
        </span>
        {isExternalPending && (
          <span className="shrink-0 whitespace-nowrap rounded-md bg-claude-dim px-1.5 py-0.5 text-[10px] font-medium text-claude">
            Pending in terminal
          </span>
        )}
        {isExpandable && (
          <ChevronRight
            size={10}
            className={`mt-[5px] shrink-0 text-muted/40 transition-all duration-200 ${
              expanded ? "rotate-90 opacity-100" : "opacity-0 group-hover/entry:opacity-100"
            }`}
          />
        )}
      </div>
      {/* Expanded content — smooth animated open/close */}
      <AnimatePresence initial={false}>
        {expanded && hasRichContent && hasBeenExpanded.current && (
          <motion.div
            key="tool-content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{
              height: { duration: 0.2, ease: [0.25, 0.1, 0.25, 1] },
              opacity: { duration: 0.15 },
            }}
            className="overflow-hidden"
          >
            <div className="pl-[18px] pr-2 pb-1.5">
              <ToolContent
                tool={tool!}
                input={input!}
                resultDetail={resultDetail}
                onSendMessage={onSendMessage}
                onAnswerUserInput={onAnswerUserInput}
                isInteractive={isInteractive}
                resolution={resolution}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence initial={false}>
        {expanded && isPermDenied && (
          <motion.div
            key="perm-denied"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{
              height: { duration: 0.2, ease: [0.25, 0.1, 0.25, 1] },
              opacity: { duration: 0.15 },
            }}
            className="overflow-hidden"
          >
            <div className="pl-[18px] pr-2 pb-1.5">
              <PermissionDeniedContent
                tool={permissionDenied!}
                onApproveTool={onApproveTool}
                isInteractive={isInteractive}
                approvedTools={approvedTools}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
