/**
 * Interactive JSON tree viewer with expand/collapse, search, and path copying.
 *
 * Renders arbitrary JSON data as a navigable tree. Supports:
 * - Expand/collapse at any depth (click chevron or key)
 * - Expand-all / collapse-all controls
 * - Text search with match highlighting and jump-to-match
 * - Click-to-copy JSON path
 * - Virtualized rendering for large payloads (via max-height + overflow)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  Search,
  ChevronsDown,
  ChevronsUp,
  X,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { Button } from "./button";
import { toast } from "sonner";

// ── Types ────────────────────────────────────────────────────────────

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

interface JsonNodeData {
  key: string;
  path: string;
  value: JsonValue;
  depth: number;
}

// ── Helpers ──────────────────────────────────────────────────────────

function isExpandable(value: JsonValue): value is JsonValue[] | Record<string, JsonValue> {
  return value !== null && typeof value === "object";
}

function childCount(value: JsonValue): number {
  if (Array.isArray(value)) return value.length;
  if (value !== null && typeof value === "object") return Object.keys(value).length;
  return 0;
}

function typeLabel(value: JsonValue): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `Array(${value.length})`;
  if (typeof value === "object") return `Object(${Object.keys(value).length})`;
  return typeof value;
}

function formatPrimitive(value: JsonValue): { text: string; className: string } {
  if (value === null) return { text: "null", className: "text-muted italic" };
  if (typeof value === "boolean")
    return { text: String(value), className: value ? "text-accent" : "text-error" };
  if (typeof value === "number") return { text: String(value), className: "text-user-label" };
  if (typeof value === "string") {
    const truncated = value.length > 300 ? value.slice(0, 300) + "…" : value;
    return { text: `"${truncated}"`, className: "text-text" };
  }
  return { text: String(value), className: "text-text" };
}

function getChildren(value: JsonValue): JsonNodeData[] {
  if (Array.isArray(value)) {
    return value.map((v, i) => ({
      key: String(i),
      path: `[${i}]`,
      value: v,
      depth: 0,
    }));
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value).map(([k, v]) => ({
      key: k,
      path: /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(k) ? `.${k}` : `["${k}"]`,
      value: v,
      depth: 0,
    }));
  }
  return [];
}

/** Collect all expandable paths for expand-all. */
function collectExpandablePaths(
  value: JsonValue,
  prefix: string,
  maxDepth: number,
  depth = 0,
): string[] {
  if (depth >= maxDepth || !isExpandable(value)) return [];
  const paths = [prefix];
  const children = getChildren(value);
  for (const child of children) {
    const childPath = prefix + child.path;
    paths.push(...collectExpandablePaths(child.value, childPath, maxDepth, depth + 1));
  }
  return paths;
}

// ── Search ───────────────────────────────────────────────────────────

interface SearchMatch {
  path: string;
  key: string;
  valuePreview: string;
}

function searchJson(
  value: JsonValue,
  query: string,
  prefix: string,
  results: SearchMatch[],
  maxResults = 200,
): void {
  if (results.length >= maxResults) return;
  const lowerQuery = query.toLowerCase();

  const children = getChildren(value);
  for (const child of children) {
    if (results.length >= maxResults) return;
    const fullPath = prefix + child.path;
    const keyMatch = child.key.toLowerCase().includes(lowerQuery);
    const valueStr = isExpandable(child.value) ? typeLabel(child.value) : String(child.value);
    const valueMatch = valueStr.toLowerCase().includes(lowerQuery);

    if (keyMatch || valueMatch) {
      results.push({ path: fullPath, key: child.key, valuePreview: valueStr.slice(0, 120) });
    }
    if (isExpandable(child.value)) {
      searchJson(child.value, query, fullPath, results, maxResults);
    }
  }
}

// ── Components ───────────────────────────────────────────────────────

function JsonNode({
  node,
  parentPath,
  expanded,
  searchQuery,
  activeMatchPath,
  onToggle,
  onCopyPath,
}: {
  node: JsonNodeData;
  parentPath: string;
  expanded: Set<string>;
  searchQuery: string;
  activeMatchPath: string | null;
  onToggle: (path: string) => void;
  onCopyPath: (path: string) => void;
}) {
  const fullPath = parentPath + node.path;
  const expandable = isExpandable(node.value);
  const isOpen = expanded.has(fullPath);
  const count = expandable ? childCount(node.value) : 0;
  const isActiveMatch = activeMatchPath === fullPath;
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isActiveMatch && rowRef.current) {
      rowRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [isActiveMatch]);

  const highlightText = (text: string): React.ReactNode => {
    if (!searchQuery) return text;
    const lower = text.toLowerCase();
    const idx = lower.indexOf(searchQuery.toLowerCase());
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <mark className="rounded-sm bg-warning/20 text-inherit">
          {text.slice(idx, idx + searchQuery.length)}
        </mark>
        {text.slice(idx + searchQuery.length)}
      </>
    );
  };

  return (
    <div>
      <div
        ref={rowRef}
        className={`group flex items-center gap-0.5 rounded-sm px-1 py-px hover:bg-surface-hover ${isActiveMatch ? "bg-warning/15 ring-1 ring-warning/30" : ""}`}
        style={{ paddingLeft: `${node.depth * 16 + 4}px` }}
      >
        {/* Chevron */}
        {expandable ? (
          <button
            onClick={() => onToggle(fullPath)}
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-muted hover:text-text"
          >
            {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        ) : (
          <span className="h-4 w-4 shrink-0" />
        )}

        {/* Key */}
        <span
          className={`shrink-0 font-medium text-claude ${expandable ? "cursor-pointer hover:underline" : ""}`}
          onClick={expandable ? () => onToggle(fullPath) : undefined}
        >
          {highlightText(node.key)}
        </span>
        <span className="text-muted">:</span>

        {/* Value or type summary */}
        {expandable ? (
          <button
            onClick={() => onToggle(fullPath)}
            className="ml-1 truncate text-muted hover:text-text"
          >
            {isOpen ? (
              <span className="text-muted/60">{Array.isArray(node.value) ? "[" : "{"}</span>
            ) : (
              <span>
                <span className="text-muted/60">{Array.isArray(node.value) ? "[" : "{"}</span>
                <span className="mx-0.5 text-[0.6875rem] text-muted">
                  {count} {count === 1 ? "item" : "items"}
                </span>
                <span className="text-muted/60">{Array.isArray(node.value) ? "]" : "}"}</span>
              </span>
            )}
          </button>
        ) : (
          <span className={`ml-1 truncate ${formatPrimitive(node.value).className}`}>
            {highlightText(formatPrimitive(node.value).text)}
          </span>
        )}

        {/* Copy path button (on hover) */}
        <button
          onClick={() => onCopyPath(fullPath)}
          className="ml-auto hidden shrink-0 rounded-sm p-0.5 text-muted opacity-0 transition-opacity hover:text-text group-hover:block group-hover:opacity-100"
          title="Copy path"
        >
          <ClipboardCopy size={11} />
        </button>
      </div>

      {/* Children */}
      {expandable && isOpen && (
        <div>
          {getChildren(node.value).map((child) => (
            <JsonNode
              key={child.key}
              node={{ ...child, depth: node.depth + 1 }}
              parentPath={fullPath}
              expanded={expanded}
              searchQuery={searchQuery}
              activeMatchPath={activeMatchPath}
              onToggle={onToggle}
              onCopyPath={onCopyPath}
            />
          ))}
          <div
            className="px-1 py-px text-muted/60"
            style={{ paddingLeft: `${node.depth * 16 + 20}px` }}
          >
            {Array.isArray(node.value) ? "]" : "}"}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────

interface JsonTreeViewerProps {
  data: unknown;
  /** Max height for the scrollable container. Default: "55vh" */
  maxHeight?: string;
  /** Label for root node. Default: "root" */
  rootLabel?: string;
  /** Initial expand depth. Default: 1 */
  defaultExpandDepth?: number;
  className?: string;
}

export function JsonTreeViewer({
  data,
  maxHeight = "55vh",
  rootLabel: _rootLabel = "root",
  defaultExpandDepth = 1,
  className = "",
}: JsonTreeViewerProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    if (data !== null && typeof data === "object") {
      const paths = collectExpandablePaths(data as JsonValue, "$", defaultExpandDepth);
      for (const p of paths) initial.add(p);
    }
    return initial;
  });

  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchMatch[]>([]);
  const [searchIndex, setSearchIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Re-initialize expanded state when data identity changes
  const dataRef = useRef(data);
  useEffect(() => {
    if (data !== dataRef.current) {
      dataRef.current = data;
      const initial = new Set<string>();
      if (data !== null && typeof data === "object") {
        const paths = collectExpandablePaths(data as JsonValue, "$", defaultExpandDepth);
        for (const p of paths) initial.add(p);
      }
      setExpanded(initial);
    }
  }, [data, defaultExpandDepth]);

  const handleToggle = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        // Collapse this node and all children
        for (const p of prev) {
          if (p === path || p.startsWith(path + ".") || p.startsWith(path + "[")) {
            next.delete(p);
          }
        }
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const handleExpandAll = useCallback(() => {
    if (data !== null && typeof data === "object") {
      const paths = collectExpandablePaths(data as JsonValue, "$", 20);
      setExpanded(new Set(paths));
    }
  }, [data]);

  const handleCollapseAll = useCallback(() => {
    setExpanded(new Set<string>());
  }, []);

  const handleCopyPath = useCallback((path: string) => {
    navigator.clipboard.writeText(path).then(() => {
      toast.success(`Copied: ${path}`, { duration: 1500 });
    });
  }, []);

  const handleCopyAll = useCallback(() => {
    navigator.clipboard.writeText(JSON.stringify(data, null, 2)).then(() => {
      toast.success("JSON copied to clipboard", { duration: 1500 });
    });
  }, [data]);

  // Search
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setSearchIndex(0);
      return;
    }
    const results: SearchMatch[] = [];
    searchJson(data as JsonValue, searchQuery.trim(), "$", results);
    setSearchResults(results);
    setSearchIndex(0);

    // Auto-expand paths to show matches
    if (results.length > 0) {
      setExpanded((prev) => {
        const next = new Set(prev);
        for (const match of results.slice(0, 50)) {
          // Expand all ancestor paths
          const parts = match.path.split(/(?=\[|\.)/);
          let current = parts[0]!;
          next.add(current);
          for (let i = 1; i < parts.length - 1; i++) {
            current += parts[i];
            next.add(current);
          }
        }
        return next;
      });
    }
  }, [searchQuery, data]);

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setSearchOpen(false);
      setSearchQuery("");
    }
    if (e.key === "Enter" && searchResults.length > 0) {
      if (e.shiftKey) {
        setSearchIndex((i) => (i - 1 + searchResults.length) % searchResults.length);
      } else {
        setSearchIndex((i) => (i + 1) % searchResults.length);
      }
    }
  };

  // Focus search input when opened
  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  // Keyboard shortcut: Cmd/Ctrl+F to open search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        e.key === "f" &&
        containerRef.current?.contains(document.activeElement as Node)
      ) {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const activeMatchPath =
    searchResults.length > 0 ? (searchResults[searchIndex]?.path ?? null) : null;

  // Ensure ancestors of the active match are expanded so it's visible
  useEffect(() => {
    if (!activeMatchPath) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      const parts = activeMatchPath.split(/(?=\[|\.)/);
      let current = parts[0]!;
      next.add(current);
      for (let i = 1; i < parts.length - 1; i++) {
        current += parts[i];
        next.add(current);
      }
      return next;
    });
  }, [activeMatchPath]);

  const rootChildren = useMemo(() => {
    if (data === null || data === undefined || typeof data !== "object") return [];
    return getChildren(data as JsonValue);
  }, [data]);

  const isEmpty = rootChildren.length === 0 && !isExpandable(data as JsonValue);

  return (
    <div className={`flex flex-col ${className}`}>
      {/* Toolbar */}
      <div className="flex items-center gap-1.5 border-b border-border/50 px-2 py-1.5">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setSearchOpen(!searchOpen);
            if (searchOpen) setSearchQuery("");
          }}
          className="gap-1 text-[0.6875rem]"
        >
          <Search size={12} />
          Search
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleExpandAll}
          className="gap-1 text-[0.6875rem]"
        >
          <ChevronsDown size={12} />
          Expand all
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCollapseAll}
          className="gap-1 text-[0.6875rem]"
        >
          <ChevronsUp size={12} />
          Collapse all
        </Button>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-[0.625rem] text-muted">{typeLabel(data as JsonValue)}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCopyAll}
            className="gap-1 text-[0.6875rem]"
          >
            <ClipboardCopy size={11} />
            Copy
          </Button>
        </div>
      </div>

      {/* Search bar */}
      {searchOpen && (
        <div className="flex items-center gap-2 border-b border-border/50 bg-surface px-3 py-1.5">
          <Search size={13} className="shrink-0 text-muted" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search keys and values…"
            className="flex-1 bg-transparent text-[0.75rem] text-text outline-none placeholder:text-muted/50"
          />
          {searchResults.length > 0 && (
            <div className="flex items-center gap-1">
              <span className="text-[0.6875rem] text-muted">
                {searchIndex + 1}/{searchResults.length}
              </span>
              <button
                onClick={() =>
                  setSearchIndex((i) => (i - 1 + searchResults.length) % searchResults.length)
                }
                className="rounded-sm p-0.5 text-muted hover:bg-surface-hover hover:text-text"
              >
                <ArrowUp size={12} />
              </button>
              <button
                onClick={() => setSearchIndex((i) => (i + 1) % searchResults.length)}
                className="rounded-sm p-0.5 text-muted hover:bg-surface-hover hover:text-text"
              >
                <ArrowDown size={12} />
              </button>
            </div>
          )}
          {searchQuery && searchResults.length === 0 && (
            <span className="text-[0.6875rem] text-muted">No matches</span>
          )}
          <button
            onClick={() => {
              setSearchOpen(false);
              setSearchQuery("");
            }}
            className="rounded-sm p-0.5 text-muted hover:bg-surface-hover hover:text-text"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {/* Tree */}
      <div
        ref={containerRef}
        className="overflow-auto rounded-b-lg font-mono text-[0.75rem] leading-relaxed"
        style={{ maxHeight }}
        tabIndex={0}
      >
        {isEmpty ? (
          <div className="px-4 py-6 text-center text-[0.75rem] text-muted">
            {data === null ? "null" : data === undefined ? "undefined" : "Empty"}
          </div>
        ) : isExpandable(data as JsonValue) ? (
          <div className="py-1">
            {rootChildren.map((child) => (
              <JsonNode
                key={child.key}
                node={{ ...child, depth: 0 }}
                parentPath="$"
                expanded={expanded}
                searchQuery={searchQuery}
                activeMatchPath={activeMatchPath}
                onToggle={handleToggle}
                onCopyPath={handleCopyPath}
              />
            ))}
          </div>
        ) : (
          <div className="px-4 py-2">
            <span className={formatPrimitive(data as JsonValue).className}>
              {formatPrimitive(data as JsonValue).text}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
