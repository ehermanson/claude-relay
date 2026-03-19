import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import hljs from "../../lib/markdown";
import { openNativePath } from "../../lib/api";

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
  node: _,
  ...rest
}: React.ComponentProps<"img"> & { node?: unknown }) {
  const [lightbox, setLightbox] = useState(false);
  const [error, setError] = useState(false);

  if (!src || error) {
    return <span className="text-xs italic text-muted">[Image: failed to load]</span>;
  }

  return (
    <>
      <img
        src={src}
        alt={alt || "Image"}
        className="my-1.5 inline-block h-[120px] w-[120px] object-cover cursor-pointer rounded-lg border border-border transition-all hover:border-accent hover:shadow-md"
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

function MarkdownLink({
  href = "",
  children,
  ...props
}: React.ComponentProps<"a"> & { node?: unknown }) {
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

const REMARK_PLUGINS = [remarkGfm];
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
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={MD_COMPONENTS}>
        {processed}
      </ReactMarkdown>
    </div>
  );
}
