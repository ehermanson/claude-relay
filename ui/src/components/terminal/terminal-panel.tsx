/**
 * TerminalPanel — Bottom panel containing terminal split panes.
 *
 * When there's one terminal, it fills the panel.
 * Clicking "+" creates a second terminal and enters split view (side by side, resizable).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { X, ChevronDown, Columns2 } from "lucide-react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { Tooltip } from "@/components/ui/tooltip";
import { useWSMethods } from "@/context/websocket-context";
import { useTerminalStore, scopeKey } from "@/hooks/use-terminal-store";
import { TerminalView } from "./terminal-view";
import type { ServerMessage, TerminalScope, TerminalInfo } from "@shared/types";

const MAX_TERMINALS = 4;

// ── Main Panel ───────────────────────────────────────────────────────

interface TerminalPanelProps {
  scope: TerminalScope;
  height: number;
  onResizeStart: (e: React.MouseEvent) => void;
  /** The instance ID that terminal context attachments should be associated with. */
  activeInstanceId?: string | null;
}

export function TerminalPanel({
  scope,
  height,
  onResizeStart,
  activeInstanceId,
}: TerminalPanelProps) {
  const { send, addMessageHandler } = useWSMethods();
  const {
    getTerminalsForScope,
    addTerminal,
    setTerminalsForScope,
    removeTerminal,
    updateTerminal,
    closePanel,
  } = useTerminalStore();
  const key = scopeKey(scope);
  const terminals = getTerminalsForScope(scope);

  // Track whether we've received the initial list response so we don't
  // create a duplicate terminal before knowing what already exists.
  const [listReceived, setListReceived] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Listen for terminal lifecycle messages
  useEffect(() => {
    return addMessageHandler((message: ServerMessage) => {
      if (message.type === "terminal_created") {
        const t = message.terminal;
        if (scopeKey(t.scope) === key) {
          addTerminal(t);
        }
      } else if (message.type === "terminal_removed") {
        removeTerminal(message.terminalId);
      } else if (message.type === "terminal_list_response") {
        // Only process responses that match our scope
        if (scopeKey(message.scope) !== key) return;
        // Replace — not merge — so stale terminals from a missed removal or
        // server restart are pruned instead of lingering as ghost entries.
        setTerminalsForScope(message.scope, message.terminals);
        // Mark list as received even if empty — that means we should create one
        if (mountedRef.current) {
          setListReceived(true);
        }
      } else if (message.type === "terminal_exit") {
        updateTerminal(message.terminalId, { exited: true, exitCode: message.code });
      }
    });
  }, [key, addMessageHandler, addTerminal, setTerminalsForScope, removeTerminal, updateTerminal]);

  // Request terminal list on mount
  useEffect(() => {
    setListReceived(false);
    send({ type: "terminal_list", scope });
  }, [scope, send]);

  // Auto-create first terminal only after list response confirms none exist.
  // Uses ifEmpty so the server rejects the create if another client raced us.
  useEffect(() => {
    if (!listReceived) return;
    if (getTerminalsForScope(scope).length === 0) {
      send({ type: "terminal_create", scope, ifEmpty: true });
    }
  }, [listReceived, scope, send, getTerminalsForScope]);

  const canAdd = terminals.length < MAX_TERMINALS;

  const handleNewTerminal = useCallback(() => {
    if (!canAdd) return;
    send({ type: "terminal_create", scope });
  }, [scope, send, canAdd]);

  const handleCloseTerminal = useCallback(
    (terminalId: string) => {
      send({ type: "terminal_close", terminalId });
    },
    [send],
  );

  const handleClosePanel = useCallback(() => {
    closePanel(key);
  }, [key, closePanel]);

  const isSplit = terminals.length >= 2;

  return (
    <div className="flex flex-col border-t border-border/50 bg-surface-inset" style={{ height }}>
      {/* Resize handle */}
      <div
        onMouseDown={onResizeStart}
        className="h-px shrink-0 cursor-row-resize bg-border/50 after:absolute after:inset-x-0 after:top-1/2 after:h-2 after:-translate-y-1/2 after:content-['']"
        style={{ position: "relative" }}
      />

      {/* Terminal content */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {terminals.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted">
            No terminal
          </div>
        ) : isSplit ? (
          <Group orientation="horizontal" className="h-full">
            {terminals.map((t, i) => (
              <SplitPane
                key={t.id}
                terminal={t}
                index={i}
                scope={scope}
                isLast={i === terminals.length - 1}
                onClose={() => handleCloseTerminal(t.id)}
                onAdd={handleNewTerminal}
                canAdd={canAdd}
                onClosePanel={handleClosePanel}
                activeInstanceId={activeInstanceId}
              />
            ))}
          </Group>
        ) : (
          <div className="flex h-full flex-col">
            <PaneHeader
              terminal={terminals[0]}
              index={0}
              onClose={() => handleCloseTerminal(terminals[0].id)}
              onAdd={canAdd ? handleNewTerminal : undefined}
              canAdd={canAdd}
              onClosePanel={handleClosePanel}
            />
            <div className="min-h-0 flex-1">
              <TerminalView
                key={terminals[0].id}
                terminalId={terminals[0].id}
                scope={scope}
                index={0}
                activeInstanceId={activeInstanceId}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Split pane ───────────────────────────────────────────────────────

function SplitPane({
  terminal,
  index,
  scope,
  isLast,
  onClose,
  onAdd,
  canAdd,
  onClosePanel,
  activeInstanceId,
}: {
  terminal: TerminalInfo;
  index: number;
  scope: TerminalScope;
  isLast: boolean;
  onClose: () => void;
  onAdd: () => void;
  canAdd: boolean;
  onClosePanel: () => void;
  activeInstanceId?: string | null;
}) {
  return (
    <>
      <Panel minSize={15} defaultSize={50}>
        <div className="flex h-full flex-col">
          <PaneHeader
            terminal={terminal}
            index={index}
            onClose={onClose}
            onAdd={isLast ? onAdd : undefined}
            canAdd={canAdd}
            onClosePanel={isLast ? onClosePanel : undefined}
          />
          <div className="min-h-0 flex-1">
            <TerminalView
              key={terminal.id}
              terminalId={terminal.id}
              scope={scope}
              index={index}
              activeInstanceId={activeInstanceId}
            />
          </div>
        </div>
      </Panel>
      {!isLast && (
        <Separator className="relative flex w-px items-center justify-center bg-border/50 after:absolute after:inset-y-0 after:left-1/2 after:w-2 after:-translate-x-1/2 after:content-['']" />
      )}
    </>
  );
}

// ── Per-pane header ──────────────────────────────────────────────────

function PaneHeader({
  terminal,
  index,
  onClose,
  onAdd,
  canAdd = true,
  onClosePanel,
}: {
  terminal: TerminalInfo;
  index: number;
  onClose: () => void;
  onAdd?: () => void;
  canAdd?: boolean;
  onClosePanel?: () => void;
}) {
  const { getTerminalName, renameTerminal } = useTerminalStore();
  const name = getTerminalName(terminal.id, index);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

  const commitRename = () => {
    renameTerminal(terminal.id, draft);
    setEditing(false);
  };

  useEffect(() => {
    if (editing) {
      setDraft(name);
      requestAnimationFrame(() => inputRef.current?.select());
    }
  }, [editing, name]);

  return (
    <div className="flex shrink-0 items-center gap-0.5 border-b border-border/30 bg-surface px-2 py-0.5">
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") setEditing(false);
          }}
          className="min-w-0 flex-1 rounded bg-transparent px-0.5 text-[0.6875rem] text-text outline-none ring-1 ring-border"
          spellCheck={false}
        />
      ) : (
        <span
          className="min-w-0 flex-1 cursor-default truncate text-[0.6875rem] text-muted"
          onDoubleClick={() => setEditing(true)}
          title="Double-click to rename"
        >
          {terminal.exited ? "⏹ " : ""}
          {name}
        </span>
      )}
      <div className="flex items-center gap-0.5">
        {onAdd && (
          <Tooltip content={canAdd ? "Split terminal" : `Maximum of ${MAX_TERMINALS} terminals`}>
            <button
              type="button"
              onClick={canAdd ? onAdd : undefined}
              disabled={!canAdd}
              className="rounded p-0.5 text-muted transition-colors hover:bg-surface-hover hover:text-text disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted"
            >
              <Columns2 size={12} />
            </button>
          </Tooltip>
        )}
        <button
          type="button"
          onClick={onClose}
          className="rounded p-0.5 text-muted transition-colors hover:bg-surface-hover hover:text-text"
          title="Close terminal"
        >
          <X size={12} />
        </button>
        {onClosePanel && (
          <button
            type="button"
            onClick={onClosePanel}
            className="rounded p-0.5 text-muted transition-colors hover:bg-surface-hover hover:text-text"
            title="Close terminal panel"
          >
            <ChevronDown size={12} />
          </button>
        )}
      </div>
    </div>
  );
}
