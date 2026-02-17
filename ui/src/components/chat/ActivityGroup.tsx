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
}

export function ActivityGroup({ activities, onSendMessage, isInteractive, onApproveTool, approvedTools }: ActivityGroupProps) {
  const [expanded, setExpanded] = useState(false);

  const total = activities.length;
  const hiddenCount = total - VISIBLE_COUNT;

  // Only show Allow button on the last denial per tool in this group
  const lastDenialIndex = new Map<string, number>();
  activities.forEach((act, i) => {
    if (act.permissionDenied) lastDenialIndex.set(act.permissionDenied, i);
  });

  return (
    <div className="animate-fade-in flex max-w-[90%] flex-col gap-px self-start">
      {hiddenCount > 0 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 border-none bg-transparent px-2.5 py-0.5 font-mono text-[0.625rem] text-muted opacity-80 hover:text-accent hover:opacity-100"
        >
          <span
            className={`inline-block text-[0.5625rem] transition-transform ${
              expanded ? "rotate-90" : ""
            }`}
          >
            &#9654;
          </span>
          {expanded ? "Show less" : `${hiddenCount} more`}
        </button>
      )}
      {activities.map((act, i) => {
        const isHidden = !expanded && hiddenCount > 0 && i < hiddenCount;
        const isLastDenialForTool = act.permissionDenied && lastDenialIndex.get(act.permissionDenied) === i;
        return (
          <ActivityEntry
            key={i}
            activity={act.activity}
            description={act.description}
            tool={act.tool}
            detail={act.detail}
            input={act.input}
            collapsed={isHidden}
            {...(act.tool === "AskUserQuestion" ? { onSendMessage, isInteractive } : {})}
            {...(act.permissionDenied ? { permissionDenied: act.permissionDenied, isInteractive, approvedTools, onApproveTool: isLastDenialForTool ? onApproveTool : undefined } : {})}
          />
        );
      })}
    </div>
  );
}
