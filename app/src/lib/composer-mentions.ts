import type { Task } from "@shared/types";

interface ComposerTextSegment {
  kind: "text";
  text: string;
}

interface ComposerMentionSegment {
  kind: "mention";
  path: string;
}

export type ComposerSegment = ComposerTextSegment | ComposerMentionSegment;

interface MentionTriggerMatch {
  query: string;
  rangeStart: number;
  rangeEnd: number;
}

const MENTION_RE = /(^|\s)@([^\s@]+)(?=\s|$)/g;

export function splitPromptIntoComposerSegments(prompt: string): ComposerSegment[] {
  const segments: ComposerSegment[] = [];
  let cursor = 0;

  for (const match of prompt.matchAll(MENTION_RE)) {
    const leading = match[1] ?? "";
    const path = match[2] ?? "";
    const raw = match[0] ?? "";
    const matchIndex = match.index ?? 0;
    const mentionStart = matchIndex + leading.length;

    if (mentionStart > cursor) {
      segments.push({ kind: "text", text: prompt.slice(cursor, mentionStart) });
    }

    if (path) {
      segments.push({ kind: "mention", path });
    } else if (raw) {
      segments.push({ kind: "text", text: raw });
    }

    cursor = mentionStart + 1 + path.length;
  }

  if (cursor < prompt.length) {
    segments.push({ kind: "text", text: prompt.slice(cursor) });
  }

  if (segments.length === 0) {
    segments.push({ kind: "text", text: "" });
  }

  return segments;
}

export function detectMentionTrigger(text: string, cursor: number): MentionTriggerMatch | null {
  if (cursor < 0 || cursor > text.length) return null;

  let start = cursor;
  while (start > 0) {
    const char = text[start - 1];
    if (!char || /\s/.test(char)) break;
    start -= 1;
  }

  const token = text.slice(start, cursor);
  if (!token.startsWith("@")) return null;
  if (token.length < 1) return null;

  return {
    query: token.slice(1),
    rangeStart: start,
    rangeEnd: cursor,
  };
}

export function replacePromptRange(
  text: string,
  start: number,
  end: number,
  replacement: string,
): { value: string; cursor: number } {
  const value = text.slice(0, start) + replacement + text.slice(end);
  return {
    value,
    cursor: start + replacement.length,
  };
}

// ─── Task reference expansion ──────────────────────────────────────────────

const TASK_REF_RE = /@task:([a-f0-9]{8})(?::[^\s@]*)?\b/g;

/** Escape a string for safe use inside an XML attribute (double-quoted). */
function escapeXmlAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Escape a string for safe use as XML element text content. */
function escapeXmlText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Replace `@task:<id>` tokens with `<task_reference>` XML blocks so the model
 * receives structured context about referenced tasks.
 */
export function expandTaskReferences(text: string, tasks: Task[]): string {
  return text.replace(TASK_REF_RE, (match, taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return match;
    const desc = task.description ? `\n${escapeXmlText(task.description)}` : "";
    return `<task_reference id="${escapeXmlAttr(task.id)}" title="${escapeXmlAttr(task.title)}">${desc}\n</task_reference>`;
  });
}
