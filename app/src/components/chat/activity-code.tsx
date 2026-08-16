/**
 * Code display helpers for activity entries — syntax-highlighted code blocks, patch diffs, etc.
 */

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

function highlightCode(code: string, lang?: string): string | undefined {
  if (!lang || !hljs.getLanguage(lang)) return undefined;
  try {
    return hljs.highlight(code, { language: lang }).value;
  } catch {
    return undefined;
  }
}

/**
 * Renders a patch diff (the `@@` / `+` / `-` format) with proper line coloring.
 * Provider-agnostic — works with any patch/unified diff string.
 */
export function PatchDiffView({ diff, label }: { diff: string; label?: string }) {
  const lines = diff.split("\n");

  return (
    <div className="mt-1.5 overflow-hidden rounded-md border border-border/70 text-[0.6875rem] leading-relaxed">
      {label && (
        <div className="border-b border-border/70 bg-panel-header px-2.5 py-1 font-mono text-[0.625rem] text-muted/70">
          {label}
        </div>
      )}
      <div className="overflow-x-auto bg-bg/80">
        {lines.map((line, i) => {
          let bgClass = "";
          let textClass = "text-text/80";
          let prefix = " ";

          if (line.startsWith("@@")) {
            bgClass = "bg-muted/5";
            textClass = "text-muted/60";
            prefix = "";
          } else if (line.startsWith("+")) {
            bgClass = "bg-diff-add-bg";
            textClass = "text-text/90";
            prefix = "+";
          } else if (line.startsWith("-")) {
            bgClass = "bg-diff-remove-bg";
            textClass = "text-text/90";
            prefix = "-";
          }

          // Strip the leading +/- from the display content (we show it as a styled prefix)
          const content = prefix === "+" || prefix === "-" ? line.slice(1) : line;

          return (
            <div
              key={i}
              className={`whitespace-pre px-2.5 py-px font-mono text-[0.6875rem] ${bgClass}`}
            >
              {prefix !== "" && (
                <span
                  className={`mr-2 inline-block w-3 select-none ${
                    prefix === "+"
                      ? "text-accent/60"
                      : prefix === "-"
                        ? "text-error/60"
                        : "text-transparent"
                  }`}
                >
                  {prefix}
                </span>
              )}
              <span className={textClass}>{content || " "}</span>
            </div>
          );
        })}
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
    <div className="mt-1.5 overflow-hidden rounded-md border border-border/70 text-[0.6875rem] leading-relaxed">
      {label && (
        <div className="border-b border-border/70 bg-panel-header px-2.5 py-1 font-mono text-[0.625rem] text-muted/70">
          {label}
        </div>
      )}
      {highlighted ? (
        <pre
          className="hljs m-0 overflow-x-auto bg-bg/80 px-2.5 py-1.5 font-mono text-[0.6875rem] leading-relaxed"
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
      ) : (
        <pre className="m-0 overflow-x-auto bg-bg/80 px-2.5 py-1.5 font-mono text-[0.6875rem] leading-relaxed text-text/80">
          {content}
        </pre>
      )}
    </div>
  );
}
