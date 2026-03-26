import { ActivityGroup } from "@/components/chat/activity-group";
import { getToolGroupLabel } from "@/components/chat/tool-group-label";
import type { ActivityMessage } from "@shared/types";
import type { ToolGroupData } from "@/components/chat/types";
import type { UserInputAnswer } from "@shared/types";

interface ToolContainerProps {
  groups: ToolGroupData[];
  allActivities: ActivityMessage[];
  onSendMessage?: (text: string) => void;
  onAnswerUserInput?: (requestId: string, answers: Record<string, UserInputAnswer>) => void;
  isInteractive?: boolean;
  onApproveTool?: (tool: string) => void;
  approvedTools?: Set<string>;
  isExternal?: boolean;
  planChildId?: string;
  planChildName?: string;
}

export function ToolContainer({
  groups,
  allActivities,
  onSendMessage,
  onAnswerUserInput,
  isInteractive,
  onApproveTool,
  approvedTools,
  isExternal,
  planChildId,
  planChildName,
}: ToolContainerProps) {
  return (
    <div className="rounded-lg border border-border/60 bg-surface/40">
      <div className="px-3 pt-2.5 pb-1">
        <span className="text-[10px] uppercase tracking-[0.12em] text-muted/50">
          {getToolGroupLabel(allActivities)}
        </span>
      </div>
      <div className="flex flex-col px-1 pb-1.5">
        {groups.map((g) => (
          <ActivityGroup
            key={g.originalIndex}
            activities={g.activities}
            onSendMessage={g.isLastActivityGroup ? onSendMessage : undefined}
            onAnswerUserInput={g.isLastActivityGroup ? onAnswerUserInput : undefined}
            isInteractive={g.isLastActivityGroup ? isInteractive : undefined}
            onApproveTool={g.isLastActivityGroup ? onApproveTool : undefined}
            approvedTools={approvedTools}
            isExternal={g.isLastActivityGroup ? isExternal : undefined}
            trailingResolution={g.trailingResolution}
            skipLeadingResult={g.skipLeadingResult}
            planChildId={planChildId}
            planChildName={planChildName}
          />
        ))}
      </div>
    </div>
  );
}
