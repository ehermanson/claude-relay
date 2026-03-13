/**
 * Code display helpers for activity entries — syntax highlighting, diff views, etc.
 */

import { escapeHtml } from "../../lib/utils";
import hljs from "../../lib/markdown";

const EXT_TO_LANG: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  py: "python",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  json: "json",
  css: "css",
  html: "html",
  xml: "xml",
  svg: "xml",
  swift: "swift",
  go: "go",
  rs: "rust",
  rb: "ruby",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  yaml: "yaml",
  yml: "yaml",
  sql: "sql",
  md: "markdown",
  mdx: "markdown",
  php: "php",
  toml: "ini",
  ini: "ini",
  diff: "diff",
  patch: "diff",
};

export function langFromPath(filePath?: string): string | undefined {
  if (!filePath) return undefined;
  const ext = filePath.split(".").pop()?.toLowerCase();
  return ext ? EXT_TO_LANG[ext] : undefined;
}

export function highlightCode(code: string, lang?: string): string | undefined {
  if (!lang || !hljs.getLanguage(lang)) return undefined;
  try {
    return hljs.highlight(code, { language: lang }).value;
  } catch {
    return undefined;
  }
}

const MAX_CONTENT_LINES = 80;

export function truncateContent(text: string): string {
  const lines = text.split("\n");
  if (lines.length <= MAX_CONTENT_LINES) return text;
  return (
    lines.slice(0, MAX_CONTENT_LINES).join("\n") +
    `\n... (${lines.length - MAX_CONTENT_LINES} more lines)`
  );
}

export function DiffView({
  oldStr,
  newStr,
  filePath,
  lang,
}: {
  oldStr: string;
  newStr: string;
  filePath?: string;
  lang?: string;
}) {
  const oldHighlighted = highlightCode(oldStr, lang);
  const newHighlighted = highlightCode(newStr, lang);
  const oldLines = (oldHighlighted ?? escapeHtml(oldStr)).split("\n");
  const newLines = (newHighlighted ?? escapeHtml(newStr)).split("\n");

  return (
    <div className="mt-1.5 overflow-hidden rounded-md border border-border/70 text-[11px] leading-relaxed">
      {filePath && (
        <div className="border-b border-border/70 bg-panel-header px-2.5 py-1 font-mono text-[10px] text-muted/70">
          {filePath}
        </div>
      )}
      <div className="hljs overflow-x-auto bg-transparent">
        {oldLines.map((line, i) => (
          <div
            key={`old-${i}`}
            className="whitespace-pre bg-diff-remove-bg px-2.5 py-px font-mono text-[11px]"
          >
            <span className="mr-2 inline-block w-3 select-none text-error/60">-</span>
            <span dangerouslySetInnerHTML={{ __html: line || " " }} />
          </div>
        ))}
        {newLines.map((line, i) => (
          <div
            key={`new-${i}`}
            className="whitespace-pre bg-diff-add-bg px-2.5 py-px font-mono text-[11px]"
          >
            <span className="mr-2 inline-block w-3 select-none text-accent/60">+</span>
            <span dangerouslySetInnerHTML={{ __html: line || " " }} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ActivityCodeBlock({
  content,
  label,
  lang,
}: {
  content: string;
  label?: string;
  lang?: string;
}) {
  const highlighted = highlightCode(content, lang);
  return (
    <div className="mt-1.5 overflow-hidden rounded-md border border-border/70 text-[11px] leading-relaxed">
      {label && (
        <div className="border-b border-border/70 bg-panel-header px-2.5 py-1 font-mono text-[10px] text-muted/70">
          {label}
        </div>
      )}
      {highlighted ? (
        <pre
          className="hljs m-0 overflow-x-auto bg-bg/80 px-2.5 py-1.5 font-mono text-[11px] leading-relaxed"
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
      ) : (
        <pre className="m-0 overflow-x-auto bg-bg/80 px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-text/80">
          {content}
        </pre>
      )}
    </div>
  );
}
