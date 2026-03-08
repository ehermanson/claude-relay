import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ActivityEntry } from "./activity-entry";
import type { ActivityMessage } from "@shared/types";
import { INTERACTIVE_TOOLS } from "@shared/tools";

const VISIBLE_COUNT = 3;

interface ActivityGroupProps {
  activities: ActivityMessage[];
  onSendMessage?: (text: string) => void;
  isInteractive?: boolean;
  onApproveTool?: (tool: string) => void;
  approvedTools?: Set<string>;
  isExternal?: boolean;
  /** Resolution from a tool_result in the next activity group (cross-group). */
  trailingResolution?: "approved" | "dismissed" | "feedback";
  /** Hide the leading tool_result (consumed by the previous group's resolution). */
  skipLeadingResult?: boolean;
  planChildId?: string;
  planChildName?: string;
}

export function ActivityGroup({
  activities,
  onSendMessage,
  isInteractive,
  onApproveTool,
  approvedTools,
  isExternal,
  trailingResolution,
  skipLeadingResult,
  planChildId,
  planChildName,
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

  // Detect interactive tool_uses resolved from the terminal.
  // The subsequent tool_result carries a `resolution` field set by the backend:
  //   "approved" — user approved plan / answered question
  //   "dismissed" — user cleared context or rejected without feedback
  //   "feedback" — user rejected with change requests
  const resolvedInteractive = new Map<number, "approved" | "dismissed" | "feedback">();
  const hiddenResults = new Set<number>();
  let lastInteractiveIdx = -1;
  for (let i = 0; i < activities.length; i++) {
    const act = activities[i];
    if (act.activity === "tool_use" && INTERACTIVE_TOOLS.has(act.tool || "")) {
      lastInteractiveIdx = i;
    } else if (act.activity === "tool_result" && lastInteractiveIdx >= 0) {
      resolvedInteractive.set(lastInteractiveIdx, act.resolution || "approved");
      hiddenResults.add(i); // hide the redundant "Tool completed" line
      lastInteractiveIdx = -1;
    }
  }

  // Cross-group resolution: the tool_result landed in the NEXT activity group.
  // MessageList passes trailingResolution for the unmatched interactive tool_use.
  if (lastInteractiveIdx >= 0 && trailingResolution) {
    resolvedInteractive.set(lastInteractiveIdx, trailingResolution);
  }

  // Hide a leading tool_result that was consumed by the previous group's resolution.
  if (skipLeadingResult && activities[0]?.activity === "tool_result") {
    hiddenResults.add(0);
  }

  // Build visible list preserving original indices for key stability
  const visible = activities
    .map((act, i) => ({ act, origIndex: i }))
    .filter(({ origIndex }) => !superseded.has(origIndex) && !hiddenResults.has(origIndex));

  const hiddenCount = visible.length - VISIBLE_COUNT;
  const rendered = hiddenCount > 0 && !expanded ? visible.slice(hiddenCount) : visible;

  return (
    <div className="flex flex-col gap-px">
      <AnimatePresence initial={false}>
        {hiddenCount > 0 && (
          <motion.div
            key="expand-btn"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1.5 border-none bg-transparent px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-muted/55 transition-colors duration-150 hover:text-muted/80"
            >
              <svg
                width="8"
                height="8"
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
          </motion.div>
        )}
        {rendered.map(({ act, origIndex }, vi) => {
          const isLastDenialForTool =
            act.permissionDenied && lastDenialIndex.get(act.permissionDenied) === origIndex;

          const isPendingInTerminal =
            isExternal &&
            act.activity === "tool_use" &&
            vi === rendered.length - 1 &&
            INTERACTIVE_TOOLS.has(act.tool || "");
          return (
            <motion.div
              key={`activity-${origIndex}`}
              initial={{ opacity: 0, height: 0, scale: 0.95 }}
              animate={{ opacity: 1, height: "auto", scale: 1 }}
              exit={{ opacity: 0, height: 0, scale: 0.95 }}
              transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
              style={{ transformOrigin: "top center" }}
              className="overflow-hidden"
            >
              <ActivityEntry
                activity={act.activity}
                description={act.description}
                tool={act.tool}
                detail={act.detail}
                input={act.input}
                inputDescription={act.inputDescription}
                isExternalPending={isPendingInTerminal}
                {...(act.tool === "AskUserQuestion" || act.tool === "ExitPlanMode"
                  ? {
                      onSendMessage,
                      isInteractive: resolvedInteractive.has(origIndex) ? false : isInteractive,
                      resolution: resolvedInteractive.get(origIndex),
                      ...(act.tool === "ExitPlanMode" ? { planChildId, planChildName } : {}),
                    }
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
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
