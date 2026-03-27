import { create } from "zustand";
import type { TerminalInfo, TerminalScope } from "@shared/types";

const PANEL_HEIGHT_KEY = "relay-terminal-panel-height";
const PANEL_OPEN_KEY = "relay-terminal-panel-open";
const NAMES_KEY = "relay-terminal-names";
const DEFAULT_HEIGHT = 280;
const MIN_HEIGHT = 140;
const MAX_HEIGHT = 600;

function loadHeight(): number {
  try {
    const v = Number(localStorage.getItem(PANEL_HEIGHT_KEY));
    if (v >= MIN_HEIGHT && v <= MAX_HEIGHT) return v;
  } catch {}
  return DEFAULT_HEIGHT;
}

function loadOpenScopes(): Set<string> {
  try {
    const raw = localStorage.getItem(PANEL_OPEN_KEY);
    if (raw) return new Set(JSON.parse(raw));
  } catch {}
  return new Set();
}

function persistOpenScopes(scopes: Set<string>): void {
  try {
    localStorage.setItem(PANEL_OPEN_KEY, JSON.stringify(Array.from(scopes)));
  } catch {}
}

function loadNames(): Record<string, string> {
  try {
    const raw = localStorage.getItem(NAMES_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {};
}

function persistNames(names: Record<string, string>): void {
  try {
    localStorage.setItem(NAMES_KEY, JSON.stringify(names));
  } catch {}
}

export function scopeKey(scope: TerminalScope): string {
  return scope.type === "space" ? `space:${scope.spaceId}` : `instance:${scope.instanceId}`;
}

export interface TerminalContextAttachment {
  id: string;
  terminalName: string;
  text: string;
}

let attachmentCounter = 0;

interface TerminalState {
  /** All known terminal sessions. */
  terminals: Map<string, TerminalInfo>;
  /** Active terminal per scope key. */
  activeTerminalId: Record<string, string | null>;
  /** Which scopes have the terminal panel open. */
  openScopes: Set<string>;
  /** Panel height in pixels (shared across all scopes). */
  panelHeight: number;
  /** Terminal output snippets attached to the next chat message, keyed by instance ID. */
  terminalContexts: Record<string, TerminalContextAttachment[]>;
  /** Custom terminal names (terminalId → name). Persisted to localStorage. */
  terminalNames: Record<string, string>;

  // ── Actions ──────────────────────────────────────────────────────
  /** Replace all terminals for a scope — removes stale entries not in the new list. */
  setTerminalsForScope: (scope: TerminalScope, terminals: TerminalInfo[]) => void;
  addTerminal: (terminal: TerminalInfo) => void;
  removeTerminal: (terminalId: string) => void;
  updateTerminal: (terminalId: string, update: Partial<TerminalInfo>) => void;
  setActiveTerminal: (scopeKey: string, terminalId: string) => void;
  togglePanel: (scopeKey: string) => void;
  openPanel: (scopeKey: string) => void;
  closePanel: (scopeKey: string) => void;
  setPanelHeight: (height: number) => void;
  persistHeight: () => void;
  addTerminalContext: (instanceId: string, terminalName: string, text: string) => void;
  removeTerminalContext: (instanceId: string, id: string) => void;
  clearTerminalContexts: (instanceId: string) => void;
  getTerminalContexts: (instanceId: string) => TerminalContextAttachment[];
  renameTerminal: (terminalId: string, name: string) => void;

  // ── Selectors ────────────────────────────────────────────────────
  getTerminalsForScope: (scope: TerminalScope) => TerminalInfo[];
  getActiveTerminal: (scope: TerminalScope) => TerminalInfo | undefined;
  getTerminalName: (terminalId: string, index: number) => string;
  isPanelOpen: (scope: TerminalScope) => boolean;
}

export const useTerminalStore = create<TerminalState>()((set, get) => ({
  terminals: new Map(),
  activeTerminalId: {},
  openScopes: loadOpenScopes(),
  panelHeight: loadHeight(),
  terminalContexts: {},
  terminalNames: loadNames(),

  setTerminalsForScope: (scope, terminals) =>
    set((s) => {
      const key = scopeKey(scope);
      // Start from current map, remove all entries for this scope, then add the fresh list
      const map = new Map(s.terminals);
      for (const [id, t] of map) {
        if (scopeKey(t.scope) === key) map.delete(id);
      }
      for (const t of terminals) map.set(t.id, t);
      // Fix up active terminal for this scope
      const currentActive = s.activeTerminalId[key];
      const activeStillExists = currentActive && map.has(currentActive);
      const firstForScope = terminals[0]?.id ?? null;
      return {
        terminals: map,
        activeTerminalId: {
          ...s.activeTerminalId,
          [key]: activeStillExists ? currentActive : firstForScope,
        },
      };
    }),

  addTerminal: (terminal) =>
    set((s) => {
      const map = new Map(s.terminals);
      const alreadyExists = map.has(terminal.id);
      map.set(terminal.id, terminal);
      const key = scopeKey(terminal.scope);
      // Only auto-activate if this is a genuinely new terminal, or there's no active one
      const currentActive = s.activeTerminalId[key];
      const shouldActivate = !alreadyExists || !currentActive || !map.has(currentActive);
      return {
        terminals: map,
        activeTerminalId: shouldActivate
          ? { ...s.activeTerminalId, [key]: terminal.id }
          : s.activeTerminalId,
      };
    }),

  removeTerminal: (terminalId) =>
    set((s) => {
      const map = new Map(s.terminals);
      const removed = map.get(terminalId);
      map.delete(terminalId);
      if (!removed) return { terminals: map };

      const key = scopeKey(removed.scope);
      const active = s.activeTerminalId[key];
      const newActive =
        active === terminalId
          ? (Array.from(map.values()).find((t) => scopeKey(t.scope) === key)?.id ?? null)
          : active;
      return {
        terminals: map,
        activeTerminalId: { ...s.activeTerminalId, [key]: newActive ?? null },
      };
    }),

  updateTerminal: (terminalId, update) =>
    set((s) => {
      const existing = s.terminals.get(terminalId);
      if (!existing) return s;
      const map = new Map(s.terminals);
      map.set(terminalId, { ...existing, ...update });
      return { terminals: map };
    }),

  setActiveTerminal: (key, terminalId) =>
    set((s) => ({ activeTerminalId: { ...s.activeTerminalId, [key]: terminalId } })),

  togglePanel: (key) =>
    set((s) => {
      const next = new Set(s.openScopes);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      persistOpenScopes(next);
      return { openScopes: next };
    }),

  openPanel: (key) =>
    set((s) => {
      if (s.openScopes.has(key)) return s;
      const next = new Set(s.openScopes);
      next.add(key);
      persistOpenScopes(next);
      return { openScopes: next };
    }),

  closePanel: (key) =>
    set((s) => {
      if (!s.openScopes.has(key)) return s;
      const next = new Set(s.openScopes);
      next.delete(key);
      persistOpenScopes(next);
      return { openScopes: next };
    }),

  setPanelHeight: (height) =>
    set({ panelHeight: Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, height)) }),

  persistHeight: () => {
    try {
      localStorage.setItem(PANEL_HEIGHT_KEY, String(get().panelHeight));
    } catch {}
  },

  addTerminalContext: (instanceId, terminalName, text) =>
    set((s) => {
      const existing = s.terminalContexts[instanceId] ?? [];
      return {
        terminalContexts: {
          ...s.terminalContexts,
          [instanceId]: [...existing, { id: `tc-${++attachmentCounter}`, terminalName, text }],
        },
      };
    }),

  removeTerminalContext: (instanceId, id) =>
    set((s) => {
      const existing = s.terminalContexts[instanceId] ?? [];
      return {
        terminalContexts: {
          ...s.terminalContexts,
          [instanceId]: existing.filter((c) => c.id !== id),
        },
      };
    }),

  clearTerminalContexts: (instanceId) =>
    set((s) => {
      const next = { ...s.terminalContexts };
      delete next[instanceId];
      return { terminalContexts: next };
    }),

  getTerminalContexts: (instanceId) => get().terminalContexts[instanceId] ?? [],

  renameTerminal: (terminalId, name) =>
    set((s) => {
      const trimmed = name.trim();
      const next = { ...s.terminalNames };
      if (trimmed) {
        next[terminalId] = trimmed;
      } else {
        delete next[terminalId];
      }
      persistNames(next);
      return { terminalNames: next };
    }),

  getTerminalsForScope: (scope) => {
    const key = scopeKey(scope);
    return Array.from(get().terminals.values()).filter((t) => scopeKey(t.scope) === key);
  },

  getTerminalName: (terminalId, index) => {
    return get().terminalNames[terminalId] || `Terminal ${String.fromCharCode(65 + index)}`;
  },

  getActiveTerminal: (scope) => {
    const key = scopeKey(scope);
    const activeId = get().activeTerminalId[key];
    if (!activeId) return undefined;
    return get().terminals.get(activeId);
  },

  isPanelOpen: (scope) => get().openScopes.has(scopeKey(scope)),
}));
