const JSON_START_CHARS = new Set(["{", "["]);
const JSON_END_CHARS = new Set(["}", "]"]);

export const SHRINKWRAP_TEXT_CHAR_LIMIT = 4_000;
export const SHRINKWRAP_TEXT_LINE_LIMIT = 200;
export const LARGE_JSON_PARSE_CHAR_LIMIT = 1_000_000;
export const LARGE_JSON_INPUT_CHAR_THRESHOLD = 1_500;
export const LARGE_JSON_FORMATTED_CHAR_THRESHOLD = 2_500;
export const LARGE_JSON_FORMATTED_LINE_THRESHOLD = 40;
export const LARGE_TEXT_CHAR_THRESHOLD = 20_000;
export const LARGE_TEXT_LINE_THRESHOLD = 400;

export interface LargeUserRenderMode {
  kind: "markdown" | "json" | "text";
  formattedText?: string;
  lineCount?: number;
  charCount?: number;
}

export function shouldSkipShrinkwrapForText(text: string): boolean {
  return text.length > SHRINKWRAP_TEXT_CHAR_LIMIT || countLines(text) > SHRINKWRAP_TEXT_LINE_LIMIT;
}

export function classifyLargeUserText(text: string): LargeUserRenderMode {
  const trimmed = text.trim();
  const rawLineCount = countLines(trimmed);

  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  const looksStructured = JSON_START_CHARS.has(first) && JSON_END_CHARS.has(last);

  if (looksStructured && trimmed.length <= LARGE_JSON_PARSE_CHAR_LIMIT) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed !== null && typeof parsed === "object") {
        const formattedText = JSON.stringify(parsed, null, 2);
        const lineCount = countLines(formattedText);
        const charCount = formattedText.length;
        const shouldCollapse =
          trimmed.length >= LARGE_JSON_INPUT_CHAR_THRESHOLD ||
          charCount >= LARGE_JSON_FORMATTED_CHAR_THRESHOLD ||
          lineCount >= LARGE_JSON_FORMATTED_LINE_THRESHOLD;
        if (shouldCollapse) {
          return {
            kind: "json",
            formattedText,
            lineCount,
            charCount,
          };
        }
      }
    } catch {
      // Fall through to generic large-text handling.
    }
  }

  if (trimmed.length >= LARGE_TEXT_CHAR_THRESHOLD || rawLineCount >= LARGE_TEXT_LINE_THRESHOLD) {
    return {
      kind: "text",
      formattedText: trimmed,
      lineCount: rawLineCount,
      charCount: trimmed.length,
    };
  }

  return { kind: "markdown" };
}

function countLines(text: string): number {
  if (!text) return 0;
  let lines = 1;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) lines++;
  }
  return lines;
}
