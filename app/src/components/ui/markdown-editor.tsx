import { $createCodeNode, $isCodeNode, CodeHighlightNode, CodeNode } from "@lexical/code";
import { $isLinkNode, LinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link";
import {
  $isListNode,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  ListItemNode,
  ListNode,
  REMOVE_LIST_COMMAND,
} from "@lexical/list";
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  ELEMENT_TRANSFORMERS,
  MULTILINE_ELEMENT_TRANSFORMERS,
  type Transformer,
  TRANSFORMERS,
} from "@lexical/markdown";
import { LexicalComposer, type InitialConfigType } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { TabIndentationPlugin } from "@lexical/react/LexicalTabIndentationPlugin";
import {
  $createHeadingNode,
  $createQuoteNode,
  $isHeadingNode,
  $isQuoteNode,
  HeadingNode,
  type HeadingTagType,
  QuoteNode,
} from "@lexical/rich-text";
import { $setBlocksType } from "@lexical/selection";
import {
  $createParagraphNode,
  $getSelection,
  $isRangeSelection,
  BLUR_COMMAND,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  type ElementNode,
  FORMAT_TEXT_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  type TextFormatType,
} from "lexical";
import {
  Bold,
  Braces,
  Code,
  Heading1,
  Heading2,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Quote,
} from "lucide-react";
import { type ComponentType, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FILE_MENTION_TRANSFORMER, FileMentionNode } from "./file-mention-node";
import { type FileEntry, FileMentionPlugin } from "./file-mention-plugin";

interface MarkdownEditorProps {
  /** Initial markdown. Read once on mount — remount (e.g. via `key`) to reset. */
  defaultValue: string;
  /** Called with the serialized markdown when the editor loses focus. */
  onBlur?: (markdown: string) => void;
  placeholder?: string;
  /** Extra classes for the editable surface (sizing, font, etc.). */
  className?: string;
  disabled?: boolean;
  ariaLabel?: string;
  /**
   * Enables `@`-mention file search. When provided, typing `@` opens a file
   * picker; selections render as a chip and serialize to the plain `@<path>`.
   */
  searchFiles?: (query: string) => Promise<FileEntry[]>;
}

export const EDITOR_NODES = [
  HeadingNode,
  QuoteNode,
  ListNode,
  ListItemNode,
  CodeNode,
  CodeHighlightNode,
  LinkNode,
];

// Inline emphasis (bold/italic/code) is driven by the toolbar + Cmd-B/I, not
// type-shortcuts — the star-based shortcuts collide mid-word (typing `**x**`
// trips the italic rule before the bold pair closes). Block-level shortcuts
// (`# `, `- `, `> `, ```` ``` ````) are unambiguous, so we keep those. The full
// TRANSFORMERS set is still used for load/save so existing `**bold**` etc.
// round-trips with full fidelity.
const SHORTCUT_TRANSFORMERS = [...ELEMENT_TRANSFORMERS, ...MULTILINE_ELEMENT_TRANSFORMERS];

type BlockType = "paragraph" | "h1" | "h2" | "h3" | "quote" | "code" | "bullet" | "number";

interface ToolbarState {
  isBold: boolean;
  isItalic: boolean;
  isCode: boolean;
  isLink: boolean;
  blockType: BlockType;
}

const INITIAL_TOOLBAR_STATE: ToolbarState = {
  isBold: false,
  isItalic: false,
  isCode: false,
  isLink: false,
  blockType: "paragraph",
};

function $readToolbarState(): ToolbarState {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return INITIAL_TOOLBAR_STATE;

  const anchorNode = selection.anchor.getNode();
  const element =
    anchorNode.getKey() === "root" ? anchorNode : anchorNode.getTopLevelElementOrThrow();

  let blockType: BlockType = "paragraph";
  if ($isListNode(element)) {
    blockType = element.getListType() === "number" ? "number" : "bullet";
  } else if ($isHeadingNode(element)) {
    const tag = element.getTag();
    blockType = tag === "h1" || tag === "h2" || tag === "h3" ? tag : "paragraph";
  } else if ($isQuoteNode(element)) {
    blockType = "quote";
  } else if ($isCodeNode(element)) {
    blockType = "code";
  }

  const parent = anchorNode.getParent();
  return {
    isBold: selection.hasFormat("bold"),
    isItalic: selection.hasFormat("italic"),
    isCode: selection.hasFormat("code"),
    isLink: $isLinkNode(parent) || $isLinkNode(anchorNode),
    blockType,
  };
}

function ToolbarButton({
  icon: Icon,
  label,
  active = false,
  disabled = false,
  onClick,
}: {
  icon: ComponentType<{ size?: number | string }>;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      disabled={disabled}
      // Keep focus in the editor so the command applies to the live selection.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors disabled:opacity-40 ${
        active ? "bg-accent/15 text-accent" : "text-muted hover:bg-surface-hover hover:text-text"
      }`}
    >
      <Icon size={15} />
    </button>
  );
}

function ToolbarSeparator() {
  return <span className="mx-0.5 h-4 w-px shrink-0 self-center bg-border/60" />;
}

function EditorToolbar({ disabled }: { disabled: boolean }) {
  const [editor] = useLexicalComposerContext();
  const [state, setState] = useState<ToolbarState>(INITIAL_TOOLBAR_STATE);

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => setState($readToolbarState()));
    });
  }, [editor]);

  const formatInline = useCallback(
    (format: TextFormatType) => {
      editor.dispatchCommand(FORMAT_TEXT_COMMAND, format);
    },
    [editor],
  );

  const setBlock = useCallback(
    (create: () => ElementNode) => {
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          $setBlocksType(selection, create);
        }
      });
    },
    [editor],
  );

  const toggleHeading = useCallback(
    (tag: HeadingTagType) => {
      setBlock(() => (state.blockType === tag ? $createParagraphNode() : $createHeadingNode(tag)));
    },
    [setBlock, state.blockType],
  );

  const toggleQuote = useCallback(() => {
    setBlock(() => (state.blockType === "quote" ? $createParagraphNode() : $createQuoteNode()));
  }, [setBlock, state.blockType]);

  const toggleCodeBlock = useCallback(() => {
    setBlock(() => (state.blockType === "code" ? $createParagraphNode() : $createCodeNode()));
  }, [setBlock, state.blockType]);

  const toggleBullet = useCallback(() => {
    editor.dispatchCommand(
      state.blockType === "bullet" ? REMOVE_LIST_COMMAND : INSERT_UNORDERED_LIST_COMMAND,
      undefined,
    );
  }, [editor, state.blockType]);

  const toggleNumbered = useCallback(() => {
    editor.dispatchCommand(
      state.blockType === "number" ? REMOVE_LIST_COMMAND : INSERT_ORDERED_LIST_COMMAND,
      undefined,
    );
  }, [editor, state.blockType]);

  const toggleLink = useCallback(() => {
    if (state.isLink) {
      editor.dispatchCommand(TOGGLE_LINK_COMMAND, null);
      return;
    }
    const url = window.prompt("Link URL");
    if (url) editor.dispatchCommand(TOGGLE_LINK_COMMAND, url);
  }, [editor, state.isLink]);

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-border/50 px-1.5 py-1">
      <ToolbarButton
        icon={Bold}
        label="Bold (⌘B)"
        active={state.isBold}
        disabled={disabled}
        onClick={() => formatInline("bold")}
      />
      <ToolbarButton
        icon={Italic}
        label="Italic (⌘I)"
        active={state.isItalic}
        disabled={disabled}
        onClick={() => formatInline("italic")}
      />
      <ToolbarButton
        icon={Code}
        label="Inline code"
        active={state.isCode}
        disabled={disabled}
        onClick={() => formatInline("code")}
      />
      <ToolbarSeparator />
      <ToolbarButton
        icon={Heading1}
        label="Heading 1"
        active={state.blockType === "h1"}
        disabled={disabled}
        onClick={() => toggleHeading("h1")}
      />
      <ToolbarButton
        icon={Heading2}
        label="Heading 2"
        active={state.blockType === "h2"}
        disabled={disabled}
        onClick={() => toggleHeading("h2")}
      />
      <ToolbarButton
        icon={Quote}
        label="Quote"
        active={state.blockType === "quote"}
        disabled={disabled}
        onClick={toggleQuote}
      />
      <ToolbarButton
        icon={Braces}
        label="Code block"
        active={state.blockType === "code"}
        disabled={disabled}
        onClick={toggleCodeBlock}
      />
      <ToolbarSeparator />
      <ToolbarButton
        icon={List}
        label="Bullet list"
        active={state.blockType === "bullet"}
        disabled={disabled}
        onClick={toggleBullet}
      />
      <ToolbarButton
        icon={ListOrdered}
        label="Numbered list"
        active={state.blockType === "number"}
        disabled={disabled}
        onClick={toggleNumbered}
      />
      <ToolbarSeparator />
      <ToolbarButton
        icon={LinkIcon}
        label="Link"
        active={state.isLink}
        disabled={disabled}
        onClick={toggleLink}
      />
    </div>
  );
}

/**
 * Serialize the current editor state to markdown and hand it to `onBlur` when
 * the editable loses focus — matches the save-on-blur model the settings fields use.
 */
function BlurSavePlugin({
  onBlur,
  transformers,
}: {
  onBlur?: (markdown: string) => void;
  transformers: Transformer[];
}) {
  const [editor] = useLexicalComposerContext();
  const onBlurRef = useRef(onBlur);
  onBlurRef.current = onBlur;

  useEffect(() => {
    return editor.registerCommand(
      BLUR_COMMAND,
      () => {
        const markdown = editor.read(() => $convertToMarkdownString(transformers));
        onBlurRef.current?.(markdown);
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );
  }, [editor, transformers]);

  return null;
}

/**
 * Lexical's CodeNode has no built-in exit affordance.
 * - Escape: exits the code block (low priority, no preventDefault needed)
 * - Shift+Enter: exits the code block instead of inserting a line break
 *   (high priority so it fires before RichTextPlugin's line-break handler)
 */
function CodeBlockEscapePlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    function exitIfInCodeBlock() {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return false;
      const top = selection.anchor.getNode().getTopLevelElement();
      if (!top || !$isCodeNode(top)) return false;
      const paragraph = $createParagraphNode();
      top.insertAfter(paragraph);
      paragraph.select();
      return true;
    }

    const removeEscape = editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      exitIfInCodeBlock,
      COMMAND_PRIORITY_LOW,
    );

    const removeEnter = editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event: KeyboardEvent | null) => {
        if (!event?.shiftKey) return false;
        const exited = exitIfInCodeBlock();
        if (exited) event.preventDefault();
        return exited;
      },
      COMMAND_PRIORITY_HIGH,
    );

    return () => {
      removeEscape();
      removeEnter();
    };
  }, [editor]);

  return null;
}

function DisabledStatePlugin({ disabled }: { disabled: boolean }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    editor.setEditable(!disabled);
  }, [editor, disabled]);
  return null;
}

/**
 * Markdown editor with a formatting toolbar (bold/italic/code, headings, lists,
 * quote, code block, link) plus Cmd-B/I shortcuts. Block-level markdown
 * type-shortcuts (`# `, `- `, `> `) still work; it round-trips to a plain
 * markdown string and reuses the shared `.markdown-content` styles.
 */
export function MarkdownEditor({
  defaultValue,
  onBlur,
  placeholder = "",
  className = "",
  disabled = false,
  ariaLabel,
  searchFiles,
}: MarkdownEditorProps) {
  const mentionsEnabled = !!searchFiles;

  // Load/save uses the full transformers (plus the mention transformer when
  // enabled) so existing markdown round-trips; the FileMentionNode is only
  // registered when mentions are on.
  const loadSaveTransformers = useMemo(
    () => (mentionsEnabled ? [FILE_MENTION_TRANSFORMER, ...TRANSFORMERS] : TRANSFORMERS),
    [mentionsEnabled],
  );

  const initialConfig = useMemo<InitialConfigType>(
    () => ({
      namespace: "relay-markdown-editor",
      editable: !disabled,
      onError: (error) => {
        throw error;
      },
      nodes: mentionsEnabled ? [...EDITOR_NODES, FileMentionNode] : EDITOR_NODES,
      editorState: () => $convertFromMarkdownString(defaultValue, loadSaveTransformers),
    }),
    // Initial markdown is read once; remount (via `key`) to load a new value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <EditorToolbar disabled={disabled} />
      <div className="relative px-3 py-2">
        <RichTextPlugin
          contentEditable={
            <ContentEditable
              aria-label={ariaLabel}
              aria-placeholder={placeholder}
              placeholder={() => null}
              spellCheck
              className={`markdown-content w-full focus:outline-none ${className}`}
            />
          }
          placeholder={
            <div className="markdown-content pointer-events-none absolute left-3 top-2 select-none text-muted/50">
              {placeholder}
            </div>
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
      </div>
      <HistoryPlugin />
      <ListPlugin />
      <LinkPlugin />
      <TabIndentationPlugin />
      <MarkdownShortcutPlugin transformers={SHORTCUT_TRANSFORMERS} />
      <CodeBlockEscapePlugin />
      {searchFiles ? <FileMentionPlugin search={searchFiles} /> : null}
      <BlurSavePlugin onBlur={onBlur} transformers={loadSaveTransformers} />
      <DisabledStatePlugin disabled={disabled} />
    </LexicalComposer>
  );
}
