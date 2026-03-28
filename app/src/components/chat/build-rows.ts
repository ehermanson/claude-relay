/**
 * Transforms flat ChatItem[] into RenderRow[] for the message list virtualizer.
 *
 * Handles:
 *  - Merging consecutive activity-groups into a single tool-container
 *  - Cross-group interactive tool resolution detection
 *  - Response dividers with elapsed time
 */

import type { ActivityMessage } from "@shared/types";
import { INTERACTIVE_TOOLS } from "@shared/tools";
import type { ChatItem, RenderRow, ToolGroupData, UserChatItem } from "@/lib/chat-types";

// Re-export for consumers
export type { RenderRow, ToolGroupData };

// ── Helpers ──────────────────────────────────────────────────────────

const isManagedComposerPrompt = (activity: ActivityMessage | undefined) =>
  activity?.tool === "AskUserQuestion" &&
  typeof activity.input === "object" &&
  activity.input !== null &&
  typeof (activity.input as Record<string, unknown>).requestId === "string";

function findLastIndices(items: ChatItem[]) {
  let lastActivityGroupIndex = -1;
  let lastAssistantIndex = -1;
  for (let i = items.length - 1; i >= 0; i--) {
    if (lastActivityGroupIndex === -1 && items[i].kind === "activity-group")
      lastActivityGroupIndex = i;
    if (lastAssistantIndex === -1 && items[i].kind === "assistant") lastAssistantIndex = i;
    if (lastActivityGroupIndex !== -1 && lastAssistantIndex !== -1) break;
  }
  return { lastActivityGroupIndex, lastAssistantIndex };
}

function detectCrossGroupResolutions(items: ChatItem[]) {
  const crossGroupResolution = new Map<number, "approved" | "dismissed" | "feedback">();
  const skipLeadingResultGroups = new Set<number>();

  for (let i = 0; i < items.length; i++) {
    const curr = items[i];
    if (curr.kind !== "activity-group") continue;
    const lastAct = curr.activities[curr.activities.length - 1];
    if (isManagedComposerPrompt(lastAct)) continue;
    if (lastAct?.activity !== "tool_use" || !INTERACTIVE_TOOLS.has(lastAct.tool || "")) continue;
    for (let j = i + 1; j < items.length; j++) {
      const next = items[j];
      if (next.kind !== "activity-group") continue;
      const firstAct = next.activities[0];
      if (isManagedComposerPrompt(firstAct)) continue;
      if (firstAct?.activity === "tool_result" && firstAct.resolution) {
        crossGroupResolution.set(i, firstAct.resolution!);
        skipLeadingResultGroups.add(j);
      }
      break;
    }
  }

  return { crossGroupResolution, skipLeadingResultGroups };
}

function computeElapsedLabel(
  items: ChatItem[],
  assistantIndex: number,
  assistantTimestamp?: number,
): string {
  if (!assistantTimestamp) return "";
  for (let j = assistantIndex - 1; j >= 0; j--) {
    if (items[j].kind === "user") {
      const userTs = (items[j] as UserChatItem).timestamp;
      if (userTs) {
        const seconds = Math.round((assistantTimestamp - userTs) / 1000);
        if (seconds >= 1) {
          return seconds >= 60
            ? ` \u00b7 ${Math.floor(seconds / 60)}m ${seconds % 60}s`
            : ` \u00b7 ${seconds}s`;
        }
      }
      break;
    }
  }
  return "";
}

// ── Main builder ─────────────────────────────────────────────────────

export function buildRows(items: ChatItem[]): RenderRow[] {
  const { lastActivityGroupIndex, lastAssistantIndex } = findLastIndices(items);
  const { crossGroupResolution, skipLeadingResultGroups } = detectCrossGroupResolutions(items);

  const rows: RenderRow[] = [];
  /** Tracks the most recent non-thinking row kind, so we can detect
   *  tool-container → thinking-block → assistant sequences for the divider. */
  let lastNonThinkingKind: string | null = null;
  let i = 0;

  while (i < items.length) {
    const item = items[i];

    if (item.kind === "activity-group") {
      // Collect consecutive activity-groups into one tool container
      const runStart = i;
      const groups: ToolGroupData[] = [];
      const allActivities: ActivityMessage[] = [];
      while (i < items.length && items[i].kind === "activity-group") {
        const g = items[i] as ChatItem & { kind: "activity-group" };
        const visibleActivities = g.activities.filter(
          (activity) => !isManagedComposerPrompt(activity),
        );
        if (visibleActivities.length > 0) {
          groups.push({
            activities: visibleActivities,
            originalIndex: i,
            isLastActivityGroup: i === lastActivityGroupIndex,
            trailingResolution: crossGroupResolution.get(i),
            skipLeadingResult: skipLeadingResultGroups.has(i),
          });
          allActivities.push(...visibleActivities);
        }
        i++;
      }
      if (groups.length === 0) continue;
      rows.push({
        id: `tools-${runStart}`,
        kind: "tool-container",
        groups,
        allActivities,
      });
      lastNonThinkingKind = "tool-container";
    } else {
      // Insert response divider when assistant text follows tool calls
      // (thinking-blocks can sit between the tool-container and assistant)
      if (item.kind === "assistant" && lastNonThinkingKind === "tool-container") {
        rows.push({
          id: `divider-${i}`,
          kind: "response-divider",
          durationLabel: computeElapsedLabel(items, i, item.timestamp),
        });
      }

      switch (item.kind) {
        case "user":
          rows.push({
            id: `user-${i}`,
            kind: "user",
            text: item.text,
            timestamp: item.timestamp,
          });
          break;
        case "assistant":
          rows.push({
            id: `assistant-${i}`,
            kind: "assistant",
            text: item.text,
            timestamp: item.timestamp,
            isLast: i === lastAssistantIndex,
          });
          break;
        case "system":
          rows.push({
            id: `system-${i}`,
            kind: "system",
            text: item.text,
            isError: item.isError,
          });
          break;
        case "thinking-block":
          rows.push({
            id: `thinking-${i}`,
            kind: "thinking-block",
            text: item.text,
          });
          break;
        case "agent-transcript":
          rows.push({
            id: `transcript-${i}`,
            kind: "agent-transcript",
            title: item.title,
            result: item.result,
            timestamp: item.timestamp,
          });
          break;
      }
      if (item.kind !== "thinking-block") lastNonThinkingKind = item.kind;
      i++;
    }
  }

  return rows;
}

// ── Height estimation ────────────────────────────────────────────────

export function estimateRowHeight(row: RenderRow): number {
  switch (row.kind) {
    case "user":
      return 72 + Math.ceil(row.text.length / 80) * 20;
    case "assistant":
      return Math.max(80, Math.min(500, 60 + Math.ceil(row.text.length / 60) * 20));
    case "system":
      return 44;
    case "thinking-block":
      return Math.min(420, 60 + Math.ceil(row.text.length / 80) * 16);
    case "agent-transcript":
      return 80;
    case "response-divider":
      return 36;
    case "tool-container": {
      const activityCount = row.groups.reduce((s, g) => s + g.activities.length, 0);
      return 40 + activityCount * 40;
    }
  }
}
