import type { ActivityMessage, OutputMessage } from "./types.js";

const OPEN_TAG = "<proposed_plan>";
const CLOSE_TAG = "</proposed_plan>";

type ProposedPlanSegment = { type: "text"; text: string } | { type: "plan"; plan: string };

function buildPlanActivity(plan: string, raw?: unknown): ActivityMessage {
  return {
    type: "activity",
    activity: "tool_use",
    tool: "ExitPlanMode",
    description: "Plan ready",
    input: { plan },
    inputDescription:
      plan
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.length > 0)
        ?.replace(/^#+\s*/, "") || undefined,
    raw,
  };
}

function pushTextSegment(segments: ProposedPlanSegment[], text: string): void {
  if (!text) return;
  const last = segments[segments.length - 1];
  if (last?.type === "text") {
    last.text += text;
    return;
  }
  segments.push({ type: "text", text });
}

function trailingPartialTagLength(text: string, tag: string): number {
  const lastOpen = text.lastIndexOf("<");
  if (lastOpen === -1) return 0;
  const suffix = text.slice(lastOpen);
  return tag.startsWith(suffix) ? suffix.length : 0;
}

function extractProposedPlanSegments(text: string): ProposedPlanSegment[] {
  if (!text) return [];

  const segments: ProposedPlanSegment[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const openIdx = text.indexOf(OPEN_TAG, cursor);
    if (openIdx === -1) {
      pushTextSegment(segments, text.slice(cursor));
      break;
    }

    pushTextSegment(segments, text.slice(cursor, openIdx));
    const contentStart = openIdx + OPEN_TAG.length;
    const closeIdx = text.indexOf(CLOSE_TAG, contentStart);
    if (closeIdx === -1) {
      pushTextSegment(segments, text.slice(openIdx));
      break;
    }

    segments.push({ type: "plan", plan: text.slice(contentStart, closeIdx).trim() });
    cursor = closeIdx + CLOSE_TAG.length;
  }

  return segments;
}

export function convertProposedPlanText(
  text: string,
  options?: { raw?: unknown; isWaiting?: boolean },
): Array<OutputMessage | ActivityMessage> {
  const messages: Array<OutputMessage | ActivityMessage> = [];
  for (const segment of extractProposedPlanSegments(text)) {
    if (segment.type === "text") {
      if (!segment.text) continue;
      messages.push({
        type: "output",
        text: segment.text,
        isWaiting: false,
        raw: options?.raw,
      });
      continue;
    }

    if (!segment.plan) continue;
    messages.push(buildPlanActivity(segment.plan, options?.raw));
  }

  if (options?.isWaiting) {
    messages.push({
      type: "output",
      text: "",
      isWaiting: true,
      raw: options.raw,
    });
  }

  return messages;
}

export class ProposedPlanStreamParser {
  private buffer = "";
  private planBuffer = "";
  private inPlan = false;

  push(text: string, raw?: unknown): Array<OutputMessage | ActivityMessage> {
    if (!text) return [];
    this.buffer += text;
    return this.drain(raw, false);
  }

  finish(raw?: unknown): Array<OutputMessage | ActivityMessage> {
    const messages = this.drain(raw, true);
    messages.push({
      type: "output",
      text: "",
      isWaiting: true,
      raw,
    });
    return messages;
  }

  private drain(raw: unknown, flushAll: boolean): Array<OutputMessage | ActivityMessage> {
    const messages: Array<OutputMessage | ActivityMessage> = [];

    while (this.buffer.length > 0) {
      if (!this.inPlan) {
        const openIdx = this.buffer.indexOf(OPEN_TAG);
        if (openIdx === -1) {
          const safeLength = flushAll
            ? this.buffer.length
            : this.buffer.length - trailingPartialTagLength(this.buffer, OPEN_TAG);
          if (safeLength === 0) break;
          messages.push({
            type: "output",
            text: this.buffer.slice(0, safeLength),
            isWaiting: false,
            raw,
          });
          this.buffer = this.buffer.slice(safeLength);
          continue;
        }

        if (openIdx > 0) {
          messages.push({
            type: "output",
            text: this.buffer.slice(0, openIdx),
            isWaiting: false,
            raw,
          });
        }
        this.buffer = this.buffer.slice(openIdx + OPEN_TAG.length);
        this.inPlan = true;
        continue;
      }

      const closeIdx = this.buffer.indexOf(CLOSE_TAG);
      if (closeIdx === -1) {
        const safeLength = flushAll
          ? this.buffer.length
          : this.buffer.length - trailingPartialTagLength(this.buffer, CLOSE_TAG);
        if (safeLength === 0) break;
        this.planBuffer += this.buffer.slice(0, safeLength);
        this.buffer = this.buffer.slice(safeLength);
        continue;
      }

      this.planBuffer += this.buffer.slice(0, closeIdx);
      this.buffer = this.buffer.slice(closeIdx + CLOSE_TAG.length);
      const plan = this.planBuffer.trim();
      this.planBuffer = "";
      this.inPlan = false;
      if (plan) {
        messages.push(buildPlanActivity(plan, raw));
      }
    }

    if (flushAll && this.inPlan) {
      const fallback = `${OPEN_TAG}${this.planBuffer}${this.buffer}`;
      this.planBuffer = "";
      this.buffer = "";
      this.inPlan = false;
      if (fallback) {
        messages.push({
          type: "output",
          text: fallback,
          isWaiting: false,
          raw,
        });
      }
    }

    return messages;
  }
}
