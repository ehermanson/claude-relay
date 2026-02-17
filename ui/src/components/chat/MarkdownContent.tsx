import { useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import hljs from "../../lib/markdown";

interface MarkdownContentProps {
  text: string;
}

function CopyButton({ preRef }: { preRef: React.RefObject<HTMLPreElement | null> }) {
  const btnRef = useRef<HTMLButtonElement>(null);

  const handleCopy = useCallback(() => {
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
      }
    );
  }, [preRef]);

  return (
    <button ref={btnRef} className="code-copy-btn" onClick={handleCopy}>
      Copy
    </button>
  );
}

function CodeBlock({ className, children, ...props }: React.ComponentProps<"code"> & { node?: unknown }) {
  const { node: _, ...rest } = props;
  const match = /language-(\w+)/.exec(className || "");
  const lang = match?.[1];
  const code = String(children).replace(/\n$/, "");

  if (!match) {
    return <code className={className} {...rest}>{children}</code>;
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

  const preRef = useRef<HTMLPreElement>(null);

  return (
    <pre ref={preRef}>
      <code
        className={`hljs${lang ? ` language-${lang}` : ""}`}
        dangerouslySetInnerHTML={{ __html: highlighted }}
      />
      <CopyButton preRef={preRef} />
    </pre>
  );
}

export function MarkdownContent({ text }: MarkdownContentProps) {
  return (
    <div className="markdown-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code: CodeBlock,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
