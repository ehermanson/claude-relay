import { ActivityGroup } from "@/components/chat/activity-group";
import { getToolGroupLabel } from "@/lib/tool-group-label";
import type { MergedActivity, ToolGroupData } from "@/lib/chat-types";
import type { UserInputAnswer } from "@shared/types";

interface ToolContainerProps {
  groups: ToolGroupData[];
  allActivities: MergedActivity[];
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
  const label = getToolGroupLabel(allActivities);

  return (
    <>
      {label && (
        <div className="pt-2.5 pb-1.5">
          <span className="inline-flex items-center text-[10px] uppercase tracking-[0.12em] text-muted/55">
            {label}
          </span>
        </div>
      )}
      <div className="flex flex-col pb-1.5">
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
    </>
  );
}
