import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createTextNode,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_TAB_COMMAND,
} from "lexical";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FileIcon } from "@/components/ui/file-icon";
import { $createFileMentionNode } from "./file-mention-node";

export interface FileEntry {
  path: string;
  kind: "file" | "directory";
}

// Match `@` at start or after whitespace, capturing everything after it to the end.
// Applied to the text content of the anchor node, sliced to the cursor offset.
const MENTION_RE = /(^|\s)@([^\s]*)$/;

interface TriggerState {
  query: string;
  // Absolute character offset of the `@` within the anchor node's text
  atOffset: number;
  rect: DOMRect;
}

function detectTrigger(): TriggerState | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;

  const anchor = selection.anchor;
  if (anchor.type !== "text") return null;

  const node = anchor.getNode();
  // Only fire in normal (un-decorated) text nodes
  if (node.getMode() !== "normal") return null;

  const textUpToCursor = node.getTextContent().slice(0, anchor.offset);
  const match = MENTION_RE.exec(textUpToCursor);
  if (!match) return null;

  const leading = match[1] ?? "";
  const query = match[2] ?? "";
  const atOffset = (match.index ?? 0) + leading.length;

  // Get caret rect from the live DOM selection for positioning the menu
  const domSel = window.getSelection();
  if (!domSel || domSel.rangeCount === 0) return null;
  const rect = domSel.getRangeAt(0).getBoundingClientRect();

  return { query, atOffset, rect };
}

function MentionRow({
  entry,
  selected,
  onHover,
  onSelect,
  refCallback,
}: {
  entry: FileEntry;
  selected: boolean;
  onHover: () => void;
  onSelect: () => void;
  refCallback: (el: HTMLElement | null) => void;
}) {
  const { path, kind } = entry;
  const basename = path.split("/").pop() || path;
  const parent = path.slice(0, Math.max(0, path.length - basename.length - 1));

  return (
    <div
      role="option"
      aria-selected={selected}
      ref={refCallback}
      onMouseEnter={onHover}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onSelect}
      className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 ${
        selected ? "bg-surface-hover" : ""
      }`}
    >
      <FileIcon path={path} kind={kind} className="h-3.5 w-3.5 shrink-0" />
      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="truncate text-[0.8125rem] font-medium text-text">{basename}</span>
        {parent ? <span className="truncate text-[0.75rem] text-muted">{parent}</span> : null}
      </div>
    </div>
  );
}

export function FileMentionPlugin({ search }: { search: (query: string) => Promise<FileEntry[]> }) {
  const [editor] = useLexicalComposerContext();

  // null = menu closed; non-null = menu open with this state
  const [trigger, setTrigger] = useState<TriggerState | null>(null);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [loading, setLoading] = useState(false);

  const searchRef = useRef(search);
  searchRef.current = search;
  const triggerRef = useRef(trigger);
  triggerRef.current = trigger;
  const selectedIdxRef = useRef(selectedIdx);
  selectedIdxRef.current = selectedIdx;
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  // ── Detect trigger on every editor update ──────────────────────────────────
  useEffect(() => {
    return editor.registerUpdateListener(() => {
      editor.getEditorState().read(() => {
        const state = detectTrigger();
        // Avoid redundant state updates when query hasn't changed
        const prev = triggerRef.current;
        if (state === null && prev === null) return;
        if (state !== null && prev !== null && state.query === prev.query) {
          // Rect may have moved (scrolling), update silently without re-fetching
          setTrigger((t) => (t ? { ...t, rect: state.rect } : t));
          return;
        }
        setTrigger(state);
        if (state !== null) setSelectedIdx(0);
      });
    });
  }, [editor]);

  // ── Fetch results when query changes ──────────────────────────────────────
  useEffect(() => {
    if (trigger === null) {
      setEntries([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const run = async () => {
      const results = await searchRef.current(trigger.query);
      if (cancelled) return;
      setEntries(results.slice(0, 20));
      setLoading(false);
      setSelectedIdx(0);
    };
    const timer = trigger.query === "" ? 0 : 120;
    const id = window.setTimeout(() => {
      void run();
    }, timer);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger?.query]);

  // ── Insert the chosen mention ──────────────────────────────────────────────
  const insertMention = useCallback(
    (entry: FileEntry) => {
      // Capture synchronously — setTrigger(null) below queues a re-render that
      // will set triggerRef.current = null, so reading inside editor.update()
      // (which is async/batched) risks a null read if React wins the race.
      const t = triggerRef.current;
      if (!t) return;

      editor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return;

        const anchor = selection.anchor;
        if (anchor.type !== "text") return;
        const node = anchor.getNode();
        const text = node.getTextContent();
        const cursorOffset = anchor.offset;
        const atOffset = t.atOffset;

        // Split: [before @] [@query] [after cursor]
        // We only care about replacing [@query] with the mention chip.
        if (atOffset === 0 && cursorOffset === text.length) {
          // Replace entire node
          const mention = $createFileMentionNode(entry.path);
          const space = $createTextNode(" ");
          node.replace(mention);
          mention.insertAfter(space);
          space.select();
        } else if (atOffset === 0) {
          const [atPart] = node.splitText(cursorOffset);
          const mention = $createFileMentionNode(entry.path);
          const space = $createTextNode(" ");
          atPart.replace(mention);
          mention.insertAfter(space);
          space.select();
        } else {
          const [, atPart] = node.splitText(atOffset, cursorOffset);
          if (atPart) {
            const mention = $createFileMentionNode(entry.path);
            const space = $createTextNode(" ");
            atPart.replace(mention);
            mention.insertAfter(space);
            space.select();
          }
        }
      });
      setTrigger(null);
      setEntries([]);
    },
    [editor],
  );

  // ── Keyboard navigation ───────────────────────────────────────────────────
  // Register commands ONCE on mount. Each handler checks the ref so it only
  // intercepts keys while the menu is open. The payload is the KeyboardEvent —
  // we must call event.preventDefault() ourselves; Lexical does NOT do it
  // automatically based on the return value.
  useEffect(() => {
    const remove = [
      editor.registerCommand(
        KEY_ARROW_DOWN_COMMAND,
        (event: KeyboardEvent) => {
          if (!triggerRef.current) return false;
          event.preventDefault();
          setSelectedIdx((i) => Math.min(i + 1, entriesRef.current.length - 1));
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_ARROW_UP_COMMAND,
        (event: KeyboardEvent) => {
          if (!triggerRef.current) return false;
          event.preventDefault();
          setSelectedIdx((i) => Math.max(i - 1, 0));
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (event: KeyboardEvent | null) => {
          if (!triggerRef.current) return false;
          event?.preventDefault();
          const entry = entriesRef.current[selectedIdxRef.current];
          if (entry) insertMention(entry);
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_TAB_COMMAND,
        (event: KeyboardEvent) => {
          if (!triggerRef.current) return false;
          event.preventDefault();
          const entry = entriesRef.current[selectedIdxRef.current];
          if (entry) insertMention(entry);
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_ESCAPE_COMMAND,
        (event: KeyboardEvent) => {
          if (!triggerRef.current) return false;
          event.preventDefault();
          setTrigger(null);
          setEntries([]);
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
    ];
    return () => remove.forEach((r) => r());
  }, [editor, insertMention]); // stable deps — never re-registers

  // ── Scroll selected row into view ─────────────────────────────────────────
  const rowRefs = useRef<(HTMLElement | null)[]>([]);
  useLayoutEffect(() => {
    rowRefs.current[selectedIdx]?.scrollIntoView({ block: "nearest" });
  }, [selectedIdx]);

  // ── Menu position (fixed, below caret) ───────────────────────────────────
  const menuStyle = useMemo(() => {
    if (!trigger) return {};
    const { rect } = trigger;
    return {
      position: "fixed" as const,
      top: rect.bottom + 6,
      left: Math.max(8, rect.left),
    };
  }, [trigger]);

  // ── Dismiss on click outside ──────────────────────────────────────────────
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!trigger) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setTrigger(null);
        setEntries([]);
      }
    };
    window.addEventListener("mousedown", onDown, true);
    return () => window.removeEventListener("mousedown", onDown, true);
  }, [trigger]);

  if (!trigger) return null;

  return createPortal(
    <div
      ref={menuRef}
      style={menuStyle}
      className="z-50 w-72 overflow-hidden rounded-xl border border-border/80 bg-surface-raised/95 shadow-lg backdrop-blur"
    >
      <div className="max-h-72 overflow-y-auto p-1" role="listbox">
        {loading && entries.length === 0 ? (
          <div className="px-2 py-3 text-[0.8125rem] text-muted">Searching files…</div>
        ) : entries.length === 0 ? (
          <div className="px-2 py-3 text-[0.8125rem] text-muted">No matching files.</div>
        ) : (
          entries.map((entry, i) => (
            <MentionRow
              key={entry.path}
              entry={entry}
              selected={i === selectedIdx}
              onHover={() => setSelectedIdx(i)}
              onSelect={() => insertMention(entry)}
              refCallback={(el) => {
                rowRefs.current[i] = el;
              }}
            />
          ))
        )}
      </div>
    </div>,
    document.body,
  );
}
