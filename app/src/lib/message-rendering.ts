const JSON_START_CHARS = new Set(["{", "["]);
const JSON_END_CHARS = new Set(["}", "]"]);

export const SHRINKWRAP_TEXT_CHAR_LIMIT = 4_000;
export const SHRINKWRAP_TEXT_LINE_LIMIT = 200;
export const LARGE_JSON_RENDER_CHAR_THRESHOLD = 6_000;
export const LARGE_JSON_PARSE_CHAR_LIMIT = 200_000;

export interface LargeUserRenderMode {
  kind: "markdown" | "json";
  formattedText?: string;
  lineCount?: number;
  charCount?: number;
}

export function shouldSkipShrinkwrapForText(text: string): boolean {
  return text.length > SHRINKWRAP_TEXT_CHAR_LIMIT || countLines(text) > SHRINKWRAP_TEXT_LINE_LIMIT;
}

export function classifyLargeUserText(text: string): LargeUserRenderMode {
  const trimmed = text.trim();
  if (trimmed.length < LARGE_JSON_RENDER_CHAR_THRESHOLD) {
    return { kind: "markdown" };
  }

  if (trimmed.length > LARGE_JSON_PARSE_CHAR_LIMIT) {
    return { kind: "markdown" };
  }

  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if (!JSON_START_CHARS.has(first) || !JSON_END_CHARS.has(last)) {
    return { kind: "markdown" };
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed === null || typeof parsed !== "object") {
      return { kind: "markdown" };
    }
    const formattedText = JSON.stringify(parsed, null, 2);
    return {
      kind: "json",
      formattedText,
      lineCount: countLines(formattedText),
      charCount: formattedText.length,
    };
  } catch {
    return { kind: "markdown" };
  }
}

function countLines(text: string): number {
  if (!text) return 0;
  let lines = 1;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) lines++;
  }
  return lines;
}
