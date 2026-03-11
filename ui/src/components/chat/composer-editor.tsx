import { LexicalComposer, type InitialConfigType } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { EditorRefPlugin } from "@lexical/react/LexicalEditorRefPlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import {
  $applyNodeReplacement,
  $createLineBreakNode,
  $createParagraphNode,
  $createRangeSelection,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isLineBreakNode,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  type EditorConfig,
  type EditorState,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type PointType,
  type SerializedTextNode,
  type Spread,
  TextNode,
} from "lexical";
import {
  forwardRef,
  type ClipboardEvent,
  type KeyboardEvent,
  type RefObject,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import { splitPromptIntoComposerSegments } from "../../lib/composer-mentions";
import { basenameOfPath, getFileIconUrl } from "../../lib/file-icons";

export interface ComposerEditorHandle {
  focus: () => void;
}

interface ComposerEditorProps {
  value: string;
  placeholder: string;
  placeholderClassName?: string;
  disabled?: boolean;
  className?: string;
  onChange: (value: string, selectionOffset: number) => void;
  onSelectionApplied?: () => void;
  selectionOffset?: number | null;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  onPaste?: (event: ClipboardEvent<HTMLDivElement>) => void;
}

type SerializedComposerMentionNode = Spread<
  {
    path: string;
    type: "composer-mention";
    version: 1;
  },
  SerializedTextNode
>;

class ComposerMentionNode extends TextNode {
  __path: string;

  static override getType(): string {
    return "composer-mention";
  }

  static override clone(node: ComposerMentionNode): ComposerMentionNode {
    return new ComposerMentionNode(node.__path, node.__key);
  }

  static override importJSON(serializedNode: SerializedComposerMentionNode): ComposerMentionNode {
    return $createComposerMentionNode(serializedNode.path);
  }

  constructor(path: string, key?: NodeKey) {
    const normalizedPath = path.startsWith("@") ? path.slice(1) : path;
    super(`@${normalizedPath}`, key);
    this.__path = normalizedPath;
  }

  override exportJSON(): SerializedComposerMentionNode {
    return {
      ...super.exportJSON(),
      path: this.__path,
      type: "composer-mention",
      version: 1,
    };
  }

  override createDOM(_config: EditorConfig): HTMLElement {
    const dom = document.createElement("span");
    dom.className =
      "inline-flex select-none items-center gap-1 rounded-md border border-border/80 bg-accent/10 px-1.5 py-px align-middle text-[12px] font-medium leading-[1.1] text-text";
    dom.contentEditable = "false";
    renderMentionChip(dom, this.__path);
    return dom;
  }

  override updateDOM(prevNode: ComposerMentionNode, dom: HTMLElement): boolean {
    dom.contentEditable = "false";
    if (prevNode.__path !== this.__path || prevNode.__text !== this.__text) {
      renderMentionChip(dom, this.__path);
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

function $createComposerMentionNode(path: string): ComposerMentionNode {
  return $applyNodeReplacement(new ComposerMentionNode(path));
}

function resolveTheme(): "light" | "dark" {
  return document.documentElement.classList.contains("light") ? "light" : "dark";
}

function inferEntryKind(pathValue: string): "file" | "directory" {
  const base = basenameOfPath(pathValue);
  if (base.startsWith(".") && !base.slice(1).includes(".")) return "directory";
  if (base.includes(".")) return "file";
  return "directory";
}

function renderMentionChip(container: HTMLElement, pathValue: string): void {
  container.textContent = "";
  const icon = document.createElement("img");
  icon.alt = "";
  icon.ariaHidden = "true";
  icon.loading = "lazy";
  icon.className = "h-3 w-3 shrink-0 opacity-75";
  icon.src = getFileIconUrl(pathValue, inferEntryKind(pathValue), resolveTheme());

  const label = document.createElement("span");
  label.className = "truncate";
  label.textContent = basenameOfPath(pathValue);

  container.append(icon, label);
}

function appendTextWithBreaks(paragraph: LexicalNode, text: string): void {
  if (!$isElementNode(paragraph)) return;
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    if (line) {
      paragraph.append($createTextNode(line));
    }
    if (index < lines.length - 1) {
      paragraph.append($createLineBreakNode());
    }
  });
}

function $setComposerText(value: string): void {
  const root = $getRoot();
  root.clear();
  const paragraph = $createParagraphNode();
  for (const segment of splitPromptIntoComposerSegments(value)) {
    if (segment.kind === "mention") {
      paragraph.append($createComposerMentionNode(segment.path));
      continue;
    }
    appendTextWithBreaks(paragraph, segment.text);
  }
  root.append(paragraph);
  if (root.getChildrenSize() === 0) {
    root.append($createParagraphNode());
  }
}

function getNodeTextLength(node: LexicalNode): number {
  if ($isTextNode(node)) return node.getTextContentSize();
  if ($isLineBreakNode(node)) return 1;
  if ($isElementNode(node)) {
    return node.getChildren().reduce((total, child) => total + getNodeTextLength(child), 0);
  }
  return 0;
}

function getSelectionOffsetFromPoint(point: PointType): number {
  const node = point.getNode();
  let offset = 0;
  let current: LexicalNode | null = node;

  while (current) {
    const parent = current.getParent();
    if (!parent || !$isElementNode(parent)) break;
    const siblings = parent.getChildren();
    const index = current.getIndexWithinParent();
    for (let i = 0; i < index; i += 1) {
      const sibling = siblings[i];
      if (sibling) offset += getNodeTextLength(sibling);
    }
    current = parent;
  }

  if ($isTextNode(node)) {
    return offset + Math.min(point.offset, node.getTextContentSize());
  }
  if ($isLineBreakNode(node)) {
    return offset + Math.min(point.offset, 1);
  }
  if ($isElementNode(node)) {
    const children = node.getChildren();
    for (let i = 0; i < point.offset; i += 1) {
      const child = children[i];
      if (child) offset += getNodeTextLength(child);
    }
  }
  return offset;
}

function findPointAtOffset(
  node: LexicalNode,
  remaining: { value: number },
): { key: string; offset: number; type: "text" | "element" } | null {
  if ($isTextNode(node)) {
    const length = node.getTextContentSize();
    if (remaining.value <= length) {
      return { key: node.getKey(), offset: remaining.value, type: "text" };
    }
    remaining.value -= length;
    return null;
  }

  if ($isLineBreakNode(node)) {
    const parent = node.getParent();
    if (!parent || !$isElementNode(parent)) return null;
    const index = node.getIndexWithinParent();
    if (remaining.value === 0) {
      return { key: parent.getKey(), offset: index, type: "element" };
    }
    if (remaining.value === 1) {
      return { key: parent.getKey(), offset: index + 1, type: "element" };
    }
    remaining.value -= 1;
    return null;
  }

  if ($isElementNode(node)) {
    const children = node.getChildren();
    for (const child of children) {
      const point = findPointAtOffset(child, remaining);
      if (point) return point;
    }
    if (remaining.value === 0) {
      return {
        key: node.getKey(),
        offset: children.length,
        type: "element",
      };
    }
  }

  return null;
}

function $setSelectionAtOffset(offset: number): void {
  const root = $getRoot();
  const point = findPointAtOffset(root, { value: offset });
  if (!point) {
    root.selectEnd();
    return;
  }
  const selection = $createRangeSelection();
  selection.anchor.set(point.key, point.offset, point.type);
  selection.focus.set(point.key, point.offset, point.type);
  $setSelection(selection);
}

function ComposerSyncPlugin({
  editorRef,
  value,
  selectionOffset,
  onSelectionApplied,
}: {
  editorRef: RefObject<LexicalEditor | null>;
  value: string;
  selectionOffset?: number | null;
  onSelectionApplied?: () => void;
}) {
  return (
    <SyncEffect
      editorRef={editorRef}
      value={value}
      selectionOffset={selectionOffset}
      onSelectionApplied={onSelectionApplied}
    />
  );
}

function SyncEffect({
  editorRef,
  value,
  selectionOffset,
  onSelectionApplied,
}: {
  editorRef: RefObject<LexicalEditor | null>;
  value: string;
  selectionOffset?: number | null;
  onSelectionApplied?: () => void;
}) {
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    editor.update(() => {
      const currentValue = $getRoot().getTextContent();
      if (currentValue !== value) {
        $setComposerText(value);
      }
    });
  }, [editorRef, value]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || selectionOffset == null) return;

    editor.update(() => {
      $setSelectionAtOffset(selectionOffset);
    });
    onSelectionApplied?.();
  }, [editorRef, onSelectionApplied, selectionOffset]);

  return null;
}

export const ComposerEditor = forwardRef<ComposerEditorHandle, ComposerEditorProps>(
  (
    {
      value,
      placeholder,
      placeholderClassName = "",
      disabled,
      className = "",
      onChange,
      onSelectionApplied,
      selectionOffset,
      onKeyDown,
      onPaste,
    },
    ref,
  ) => {
    const editorRef = useRef<LexicalEditor | null>(null);

    useImperativeHandle(ref, () => ({
      focus: () => {
        editorRef.current?.focus();
      },
    }));

    const initialConfig = useMemo<InitialConfigType>(
      () => ({
        namespace: "relay-composer",
        onError: (error) => {
          throw error;
        },
        nodes: [ComposerMentionNode],
      }),
      [],
    );

    const handleChange = (editorState: EditorState) => {
      editorState.read(() => {
        const nextValue = $getRoot().getTextContent();
        const selection = $getSelection();
        const offset = $isRangeSelection(selection)
          ? getSelectionOffsetFromPoint(selection.anchor)
          : nextValue.length;
        onChange(nextValue, offset);
      });
    };

    return (
      <LexicalComposer initialConfig={initialConfig}>
        <EditorRefPlugin editorRef={editorRef} />
        <ComposerSyncPlugin
          editorRef={editorRef}
          value={value}
          selectionOffset={selectionOffset}
          onSelectionApplied={onSelectionApplied}
        />
        <div className="relative">
          <PlainTextPlugin
            contentEditable={
              <ContentEditable
                aria-placeholder={placeholder}
                className={className}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
              />
            }
            placeholder={
              <div
                className={`pointer-events-none absolute inset-0 select-none text-muted ${placeholderClassName}`}
              >
                {placeholder}
              </div>
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
        </div>
        <OnChangePlugin onChange={handleChange} ignoreHistoryMergeTagChange />
        <HistoryPlugin />
        {disabled ? <DisabledStatePlugin /> : null}
      </LexicalComposer>
    );
  },
);

ComposerEditor.displayName = "ComposerEditor";

function DisabledStatePlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    editor.setEditable(false);
    return () => {
      editor.setEditable(true);
    };
  }, [editor]);

  return null;
}
