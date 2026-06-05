import type { TextMatchTransformer } from "@lexical/markdown";
import {
  $applyNodeReplacement,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedTextNode,
  type Spread,
  TextNode,
} from "lexical";
import { basenameOfPath, getFileIconUrl } from "@/lib/file-icons";

type SerializedFileMentionNode = Spread<
  { path: string; type: "file-mention"; version: 1 },
  SerializedTextNode
>;

function resolveTheme(): "light" | "dark" {
  return document.documentElement.classList.contains("light") ? "light" : "dark";
}

function inferEntryKind(pathValue: string): "file" | "directory" {
  const base = basenameOfPath(pathValue);
  if (base.startsWith(".") && !base.slice(1).includes(".")) return "directory";
  if (base.includes(".")) return "file";
  return "directory";
}

function renderChip(container: HTMLElement, path: string): void {
  container.textContent = "";

  const icon = document.createElement("img");
  icon.alt = "";
  icon.ariaHidden = "true";
  icon.loading = "lazy";
  icon.className = "h-3 w-3 shrink-0 opacity-75";
  icon.src = getFileIconUrl(path, inferEntryKind(path), resolveTheme());

  const label = document.createElement("span");
  label.className = "truncate";
  label.textContent = basenameOfPath(path);

  container.append(icon, label);
}

/**
 * A file `@mention` rendered as a chip identical to the chat composer's. It
 * extends TextNode so its text content is the literal `@<path>` — that means it
 * serializes to plain markdown (the file path) for free, both via
 * `getTextContent()` and the markdown transformer below.
 */
export class FileMentionNode extends TextNode {
  __path: string;

  static override getType(): string {
    return "file-mention";
  }

  static override clone(node: FileMentionNode): FileMentionNode {
    return new FileMentionNode(node.__path, node.__key);
  }

  static override importJSON(serializedNode: SerializedFileMentionNode): FileMentionNode {
    return $createFileMentionNode(serializedNode.path);
  }

  constructor(path: string, key?: NodeKey) {
    const normalizedPath = path.startsWith("@") ? path.slice(1) : path;
    super(`@${normalizedPath}`, key);
    this.__path = normalizedPath;
  }

  getPath(): string {
    return this.__path;
  }

  override exportJSON(): SerializedFileMentionNode {
    return {
      ...super.exportJSON(),
      path: this.__path,
      type: "file-mention",
      version: 1,
    };
  }

  override createDOM(_config: EditorConfig): HTMLElement {
    const dom = document.createElement("span");
    dom.className =
      "inline-flex select-none items-center gap-1 rounded-md border border-border/80 bg-accent/10 px-1.5 py-px text-[12px] font-medium leading-[1.1] text-text";
    dom.style.verticalAlign = "-0.15em";
    dom.contentEditable = "false";
    renderChip(dom, this.__path);
    return dom;
  }

  override updateDOM(prevNode: FileMentionNode, dom: HTMLElement): boolean {
    dom.contentEditable = "false";
    if (prevNode.__path !== this.__path || prevNode.__text !== this.__text) {
      renderChip(dom, this.__path);
    }
    return false;
  }

  override canInsertTextBefore(): false {
    return false;
  }

  override canInsertTextAfter(): false {
    return false;
  }

  override isTextEntity(): true {
    return true;
  }

  override isToken(): true {
    return true;
  }
}

export function $createFileMentionNode(path: string): FileMentionNode {
  return $applyNodeReplacement(new FileMentionNode(path));
}

export function $isFileMentionNode(node: LexicalNode | null | undefined): node is FileMentionNode {
  return node instanceof FileMentionNode;
}

// Only treat a token as a file mention on import if it looks like an actual
// path — it contains a `/` or ends in a file extension. This keeps prose `@`
// tokens (e.g. `@param`, `@you`) from turning into bogus file chips when an
// existing markdown file is loaded back into the editor.
const MENTION_IMPORT_RE = /@([^\s@]*\/[^\s@]*|[^\s@]+\.[A-Za-z0-9_]+)/;

/**
 * Markdown transformer used only for load (`$convertFromMarkdownString`) and
 * save (`$convertToMarkdownString`) — NOT registered with the live shortcut
 * plugin, so typing `@foo` never auto-converts (the typeahead handles insertion).
 */
export const FILE_MENTION_TRANSFORMER: TextMatchTransformer = {
  dependencies: [FileMentionNode],
  export: (node) => ($isFileMentionNode(node) ? `@${node.getPath()}` : null),
  importRegExp: MENTION_IMPORT_RE,
  // Never matches during live typing; insertion is driven by the typeahead menu.
  regExp: /$.^/,
  replace: (textNode, match) => {
    textNode.replace($createFileMentionNode(match[1]));
  },
  type: "text-match",
};
