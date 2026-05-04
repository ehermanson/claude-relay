import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { X, ListChecks } from "lucide-react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import hljs from "../../lib/markdown";
import { openNativePath } from "../../lib/api";
import { FileIcon } from "@/components/ui/file-icon";

interface MarkdownContentProps {
  text: string;
}

// Convert [Image: source: /path/to/file.png] → markdown image syntax
export const IMAGE_PATTERN = /\[Image: source: ([^\]]+)\]/g;

function preprocessImages(text: string): string {
  return text.replace(IMAGE_PATTERN, (_match, filePath: string) => {
    const encoded = encodeURIComponent(filePath.trim());
    return `![Image](/api/file?path=${encoded})`;
  });
}

// ── Remark plugin: convert @mentions in text nodes into link nodes ────────
// Operates on the parsed mdast tree so it never touches text inside links,
// code blocks, or inline code — only bare prose text nodes.

const MENTION_AST_RE = /((?:^|\s))@(task:[a-f0-9]{8}(?::[^\s@]*)?|[^\s@]+)(?=\s|$)/g;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MdastNode = any;

function remarkMentions() {
  return (tree: MdastNode) => {
    walkMentions(tree, false);
  };
}

function walkMentions(node: MdastNode, insideLink: boolean): void {
  if (!node.children) return;

  const next: MdastNode[] = [];
  for (const child of node.children as MdastNode[]) {
    if (child.type === "text" && !insideLink) {
      const parts = splitMentionText(child.value as string);
      next.push(...parts);
    } else {
      walkMentions(child, insideLink || child.type === "link");
      next.push(child);
    }
  }
  node.children = next;
}

function splitMentionText(text: string): MdastNode[] {
  const result: MdastNode[] = [];
  let last = 0;

  for (const m of text.matchAll(MENTION_AST_RE)) {
    const leading = m[1] ?? "";
    const token = m[2] ?? "";
    const atPos = (m.index ?? 0) + leading.length;

    if (atPos > last) {
      result.push({ type: "text", value: text.slice(last, atPos) });
    }

    const url = token.startsWith("task:")
      ? `relay-task-mention:${token.slice(5)}`
      : `relay-file-mention:${token}`;

    result.push({
      type: "link",
      url,
      children: [{ type: "text", value: token }],
    });

    last = atPos + 1 + token.length; // skip @ + token
  }

  if (last < text.length) {
    result.push({ type: "text", value: text.slice(last) });
  }

  return result.length > 0 ? result : [{ type: "text", value: text }];
}

function ImageLightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Portal to document.body so it escapes overflow-hidden / transform parents
  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 cursor-pointer backdrop-blur-md"
      onClick={onClose}
    >
      <button
        className="absolute top-5 right-5 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white/80 transition-colors hover:bg-white/20 hover:text-white"
        onClick={onClose}
        aria-label="Close"
      >
        <X size={18} />
      </button>
      <img
        src={src}
        alt={alt}
        className="max-w-[90vw] max-h-[90vh] rounded-xl object-contain shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
    </div>,
    document.body,
  );
}

export function ImageThumbnail({
  src,
  alt,
  hideOnError,
  node: _,
  ...rest
}: React.ComponentProps<"img"> & { node?: unknown; hideOnError?: boolean }) {
  const [lightbox, setLightbox] = useState(false);
  const [error, setError] = useState(false);

  if (!src || error) {
    if (hideOnError) return null;
    return <span className="text-xs italic text-muted">[Image: failed to load]</span>;
  }

  return (
    <>
      <img
        src={src}
        alt={alt || "Image"}
        className="inline-block h-[120px] w-[120px] object-cover cursor-pointer rounded-lg border border-border transition-all hover:border-accent hover:shadow-md"
        onClick={() => setLightbox(true)}
        onError={() => setError(true)}
        {...rest}
      />
      {lightbox && (
        <ImageLightbox src={src} alt={alt || "Image"} onClose={() => setLightbox(false)} />
      )}
    </>
  );
}

function CopyButton({ preRef }: { preRef: React.RefObject<HTMLPreElement | null> }) {
  const btnRef = useRef<HTMLButtonElement>(null);

  const handleCopy = () => {
    const code = preRef.current?.querySelector("code");
    const text = code?.textContent || preRef.current?.textContent || "";
    navigator.clipboard.writeText(text).then(
      () => {
        if (!btnRef.current) return;
        btnRef.current.textContent = "Copied!";
        btnRef.current.classList.add("copied");
        setTimeout(() => {
          if (!btnRef.current) return;
          btnRef.current.textContent = "Copy";
          btnRef.current.classList.remove("copied");
        }, 1500);
      },
      () => {
        if (!btnRef.current) return;
        btnRef.current.textContent = "Failed";
        setTimeout(() => {
          if (!btnRef.current) return;
          btnRef.current.textContent = "Copy";
        }, 1500);
      },
    );
  };

  return (
    <button ref={btnRef} className="code-copy-btn" onClick={handleCopy}>
      Copy
    </button>
  );
}

function CodeBlock({
  className,
  children,
  ...props
}: React.ComponentProps<"code"> & { node?: unknown }) {
  const { node: _, ...rest } = props;
  const match = /language-(\w+)/.exec(className || "");
  const lang = match?.[1];
  const code = String(children).replace(/\n$/, "");

  if (!match) {
    return (
      <code className={className} {...rest}>
        {children}
      </code>
    );
  }

  let highlighted: string;
  if (lang && hljs.getLanguage(lang)) {
    try {
      highlighted = hljs.highlight(code, { language: lang }).value;
    } catch {
      highlighted = code;
    }
  } else {
    highlighted = code;
  }

  // ReactMarkdown already wraps fenced code in <pre>, so just return <code>
  return (
    <code
      className={`hljs${lang ? ` language-${lang}` : ""}`}
      dangerouslySetInnerHTML={{ __html: highlighted }}
    />
  );
}

function PreBlock({
  children,
  node: _,
  ...rest
}: React.ComponentProps<"pre"> & { node?: unknown }) {
  const preRef = useRef<HTMLPreElement>(null);

  return (
    <pre ref={preRef} {...rest}>
      {children}
      <CopyButton preRef={preRef} />
    </pre>
  );
}

function parseNativeFileHref(
  href: string,
): { path: string; line?: number; column?: number } | null {
  if (
    !href ||
    href.startsWith("#") ||
    href.startsWith("/api/") ||
    /^[a-z][a-z0-9+.-]*:/i.test(href)
  ) {
    if (!href.startsWith("file://")) return null;
  }

  let rawPath = href;
  let hash = "";

  if (href.startsWith("file://")) {
    const url = new URL(href);
    rawPath = decodeURIComponent(url.pathname);
    hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
    if (/^\/[A-Za-z]:\//.test(rawPath)) {
      rawPath = rawPath.slice(1);
    }
  } else {
    if (!(href.startsWith("/") || /^[A-Za-z]:[\\/]/.test(href))) {
      return null;
    }
    const hashIndex = href.indexOf("#");
    if (hashIndex >= 0) {
      rawPath = href.slice(0, hashIndex);
      hash = href.slice(hashIndex + 1);
    }
  }

  const path = decodeURIComponent(rawPath);
  const lineMatch = hash.match(/^L(\d+)(?:C(\d+))?$/i);
  return {
    path,
    line: lineMatch ? Number.parseInt(lineMatch[1], 10) : undefined,
    column: lineMatch?.[2] ? Number.parseInt(lineMatch[2], 10) : undefined,
  };
}

function MentionChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-accent/8 px-1.5 py-px align-middle text-[0.75rem] font-medium leading-tight text-text">
      {children}
    </span>
  );
}

function MarkdownLink({
  href = "",
  children,
  ...props
}: React.ComponentProps<"a"> & { node?: unknown }) {
  if (href.startsWith("relay-file-mention:")) {
    const path = href.slice("relay-file-mention:".length);
    const basename = path.split("/").pop() || path;
    return (
      <MentionChip>
        <FileIcon path={path} size={12} className="h-3 w-3" />
        <span className="max-w-[12rem] truncate">{basename}</span>
      </MentionChip>
    );
  }

  if (href.startsWith("relay-task-mention:")) {
    const encoded = href.slice("relay-task-mention:".length);
    // encoded is "taskId" or "taskId:EncodedTitle"
    const colonIdx = encoded.indexOf(":");
    let title: string;
    if (colonIdx === -1) {
      title = encoded;
    } else {
      try {
        title = decodeURIComponent(encoded.slice(colonIdx + 1));
      } catch {
        title = encoded.slice(colonIdx + 1);
      }
    }
    return (
      <MentionChip>
        <ListChecks size={12} className="h-3 w-3 shrink-0 text-muted" />
        <span className="text-muted">task:</span>
        <span className="max-w-[12rem] truncate">{title}</span>
      </MentionChip>
    );
  }

  const nativeTarget = parseNativeFileHref(href);

  if (nativeTarget) {
    return (
      <a
        href={href}
        {...props}
        onClick={async (event) => {
          event.preventDefault();
          try {
            await openNativePath(nativeTarget);
          } catch {
            // Keep the link inert on failure instead of routing the SPA to a filesystem-looking path.
          }
        }}
      >
        {children}
      </a>
    );
  }

  const external = /^https?:\/\//i.test(href);
  const isAnchor = href.startsWith("#");
  return (
    <a
      href={href}
      {...props}
      target={external ? "_blank" : props.target}
      rel={external ? "noreferrer" : props.rel}
      onClick={
        !external && !isAnchor
          ? (e) => {
              // Relative links would navigate the SPA to a bogus route — just suppress.
              e.preventDefault();
            }
          : undefined
      }
    >
      {children}
    </a>
  );
}

const REMARK_PLUGINS = [remarkGfm, remarkMentions];
const MD_COMPONENTS = {
  code: CodeBlock,
  pre: PreBlock,
  img: ImageThumbnail,
  a: MarkdownLink,
};

export function MarkdownContent({ text }: MarkdownContentProps) {
  const processed = preprocessImages(text);

  return (
    <div className="markdown-content">
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        components={MD_COMPONENTS}
        urlTransform={(url) => (url.startsWith("relay-") ? url : defaultUrlTransform(url))}
      >
        {processed}
      </ReactMarkdown>
    </div>
  );
}
