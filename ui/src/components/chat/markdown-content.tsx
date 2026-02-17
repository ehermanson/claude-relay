import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import hljs from "../../lib/markdown";

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
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
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

const REMARK_PLUGINS = [remarkGfm];
const MD_COMPONENTS = {
  code: CodeBlock,
  pre: PreBlock,
  img: ImageThumbnail,
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
