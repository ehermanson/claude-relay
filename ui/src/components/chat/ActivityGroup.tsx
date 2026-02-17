import { useState } from "react";
import { ActivityEntry } from "./ActivityEntry";
import type { ActivityMessage } from "@shared/types";

const VISIBLE_COUNT = 3;

interface ActivityGroupProps {
  activities: ActivityMessage[];
  onSendMessage?: (text: string) => void;
  isInteractive?: boolean;
  onApproveTool?: (tool: string) => void;
  approvedTools?: Set<string>;
  isExternal?: boolean;
}

export function ActivityGroup({
  activities,
  onSendMessage,
  isInteractive,
  onApproveTool,
  approvedTools,
  isExternal,
}: ActivityGroupProps) {
  const [expanded, setExpanded] = useState(false);

  // Only show Allow button on the last denial per tool in this group
  const lastDenialIndex = new Map<string, number>();
  activities.forEach((act, i) => {
    if (act.permissionDenied) lastDenialIndex.set(act.permissionDenied, i);
  });

  // Hide earlier denied attempts when the same tool was retried within this group.
  // For each tool with multiple denials, hide all but the last tool_use + tool_result pair.
  const superseded = new Set<number>();
  for (const [tool, lastIdx] of lastDenialIndex) {
    activities.forEach((act, i) => {
      if (i >= lastIdx) return;
      if (act.permissionDenied === tool) {
        superseded.add(i);
        if (i > 0 && activities[i - 1].activity === "tool_use" && activities[i - 1].tool === tool) {
          superseded.add(i - 1);
        }
      }
    });
  }

  // Build visible list preserving original indices for key stability
  const visible = activities
    .map((act, i) => ({ act, origIndex: i }))
    .filter(({ origIndex }) => !superseded.has(origIndex));

  const hiddenCount = visible.length - VISIBLE_COUNT;

  return (
    <div className="animate-fade-in flex flex-col gap-px">
      {hiddenCount > 0 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 border-none bg-transparent px-2.5 py-1 text-[0.6875rem] text-muted transition-colors hover:text-accent"
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`transition-transform ${expanded ? "rotate-90" : ""}`}
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
          {expanded ? "Show less" : `${hiddenCount} more`}
        </button>
      )}
      {visible.map(({ act, origIndex }, vi) => {
        const isCollapsed = !expanded && hiddenCount > 0 && vi < hiddenCount;
        const isLastDenialForTool =
          act.permissionDenied && lastDenialIndex.get(act.permissionDenied) === origIndex;
        const INTERACTIVE_TOOLS = ["AskUserQuestion", "ExitPlanMode", "EnterPlanMode"];
        const isPendingInTerminal =
          isExternal &&
          act.activity === "tool_use" &&
          vi === visible.length - 1 &&
          INTERACTIVE_TOOLS.includes(act.tool || "");
        return (
          <ActivityEntry
            key={origIndex}
            activity={act.activity}
            description={act.description}
            tool={act.tool}
            detail={act.detail}
            input={act.input}
            inputDescription={act.inputDescription}
            collapsed={isCollapsed}
            isExternalPending={isPendingInTerminal}
            {...(act.tool === "AskUserQuestion" || act.tool === "ExitPlanMode"
              ? { onSendMessage, isInteractive }
              : {})}
            {...(act.permissionDenied
              ? {
                  permissionDenied: act.permissionDenied,
                  isInteractive,
                  approvedTools,
                  onApproveTool: isLastDenialForTool ? onApproveTool : undefined,
                }
              : {})}
          />
        );
      })}
    </div>
  );
}
