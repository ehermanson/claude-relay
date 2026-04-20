/**
 * Suggestions — built-in definitions and resolution logic.
 *
 * Resolution order: built-in defaults -> global patches/customs -> project patches/customs.
 * Disabled at global level = hidden everywhere (project cannot re-enable).
 * Cap at 8 total resolved suggestions.
 *
 * Conditions:
 * - Client-evaluated: `has-changes`, `in-space` — sent in the response, filtered by the UI
 * - Server-evaluated: `has-tasks` — filtered during resolution, never sent to the client
 */

import type { BuiltInSuggestion, SuggestionsConfig, ResolvedSuggestion } from "#core/types.js";

/** Maximum number of resolved suggestions shown in the UI. */
export const MAX_SUGGESTIONS = 8;

/** Server-evaluated conditions that are filtered during resolution. */
type ServerCondition = "has-tasks";

/** Immutable set of built-in prompt suggestions. */
export const BUILT_IN_SUGGESTIONS: BuiltInSuggestion[] = [
  // ── Always visible (no conditions) ──────────────────────────────────
  {
    id: "explore-codebase",
    label: "Explore the Codebase",
    description: "Get oriented with the project structure, architecture, and tech stack.",
    icon: "Search",
    prompt:
      "Read the project structure and key files, then give me a brief overview of the architecture and tech stack.",
  },
  {
    id: "find-issues",
    label: "Find & Fix Issues",
    description: "Scan for potential bugs, code smells, or improvements.",
    icon: "Bug",
    prompt:
      "Scan the codebase for potential bugs, code smells, or improvements. Give me a prioritized list of findings ranked by importance.",
  },

  // ── Requires a reviewable diff (uncommitted OR ahead of base) ───────
  {
    id: "review-changes",
    label: "Review Changes",
    description: "Check recent work for bugs, edge cases, and oversights.",
    icon: "Eye",
    prompt:
      "Review the changes in this workspace — both uncommitted edits and any commits that aren't yet in the base branch. Give me a prioritized list of issues ranked by importance.",
    conditions: ["has-reviewable-diff"],
  },
  {
    id: "write-tests",
    label: "Write Tests",
    description: "Generate tests for recent changes, matching project conventions.",
    icon: "FlaskConical",
    prompt:
      "Write tests for the recent changes in this workspace — both uncommitted edits and any commits that aren't yet in the base branch. Match the existing test patterns and conventions in the project.",
    conditions: ["has-reviewable-diff"],
  },

  // ── Requires space with sibling chats ───────────────────────────────
  {
    id: "continue-work",
    label: "Continue Work",
    description: "Pick up where the last chat left off using the shared context.",
    icon: "Play",
    prompt:
      "Read the shared context and recent chat history, then pick up the next piece of unfinished work.",
    conditions: ["in-space"],
  },
  {
    id: "summarize-progress",
    label: "Summarize Progress",
    description: "Recap what's been done so far based on the diff and shared context.",
    icon: "ScrollText",
    prompt:
      "Summarize what has been accomplished in this space so far based on the git diff and shared context.",
    conditions: ["in-space", "has-reviewable-diff"],
  },

  // ── Requires open tasks (server-filtered) ───────────────────────────
  {
    id: "pick-up-task",
    label: "Pick Up a Task",
    description: "Grab the highest-priority open task and start working on it.",
    icon: "ListChecks",
    prompt:
      "Read the task list and pick up the highest-priority open task. Start by understanding the requirements, then begin implementation.",
    conditions: ["has-tasks"],
  },
];

const EMPTY_CONFIG: SuggestionsConfig = { patches: {}, custom: [] };

/** Server-side context for pre-filtering suggestions the client can't evaluate. */
export interface SuggestionContext {
  hasOpenTasks?: boolean;
}

/** Map of server-evaluated conditions to their context predicates. */
const SERVER_CONDITIONS: Record<ServerCondition, (ctx: SuggestionContext) => boolean> = {
  "has-tasks": (ctx) => !!ctx.hasOpenTasks,
};

function isServerCondition(c: string): c is ServerCondition {
  return c in SERVER_CONDITIONS;
}

/**
 * Resolve the final suggestion list from layered config.
 *
 * 1. Start with built-in suggestions
 * 2. Apply global patches (disable / prompt override) and append global customs
 * 3. Apply project patches and append project customs
 * 4. Filter disabled + server conditions, cap at MAX_SUGGESTIONS
 */
export function resolveSuggestions(
  globalConfig?: SuggestionsConfig | null,
  projectConfig?: SuggestionsConfig | null,
  context?: SuggestionContext,
): ResolvedSuggestion[] {
  const global = globalConfig ?? EMPTY_CONFIG;
  const project = projectConfig ?? EMPTY_CONFIG;
  const ctx = context ?? {};

  // Track which IDs are globally disabled (cannot be re-enabled by project)
  const globalDisabled = new Set<string>();

  // --- Build resolved list from built-ins ---
  const byId = new Map<string, ResolvedSuggestion>();

  for (const suggestion of BUILT_IN_SUGGESTIONS) {
    const gp = global.patches[suggestion.id];
    const pp = project.patches[suggestion.id];

    // Global disable is absolute
    if (gp?.disabled) {
      globalDisabled.add(suggestion.id);
      continue;
    }

    // Project disable
    if (pp?.disabled) continue;

    // Server-evaluated conditions: filter here, don't send to client
    if (suggestion.conditions?.some((c) => isServerCondition(c) && !SERVER_CONDITIONS[c](ctx))) {
      continue;
    }

    // Client-evaluated conditions: pass through for the UI to filter
    const clientConditions = suggestion.conditions?.filter((c) => !isServerCondition(c));

    byId.set(suggestion.id, {
      id: suggestion.id,
      label: suggestion.label,
      description: suggestion.description,
      icon: suggestion.icon,
      // Phase 3: prompt override layering (project > global > built-in)
      prompt: pp?.prompt ?? gp?.prompt ?? suggestion.prompt,
      builtIn: true,
      conditions: clientConditions?.length ? clientConditions : undefined,
    });
  }

  // --- Append global custom suggestions ---
  for (const custom of global.custom) {
    if (custom.disabled) {
      globalDisabled.add(custom.id);
      continue;
    }
    // Project can patch/disable global customs
    const pp = project.patches[custom.id];
    if (pp?.disabled) continue;

    byId.set(custom.id, {
      id: custom.id,
      label: custom.label,
      description: custom.description,
      icon: custom.icon,
      prompt: pp?.prompt ?? custom.prompt,
      builtIn: false,
    });
  }

  // --- Append project custom suggestions ---
  for (const custom of project.custom) {
    if (custom.disabled) continue;
    if (globalDisabled.has(custom.id)) continue;
    byId.set(custom.id, {
      id: custom.id,
      label: custom.label,
      description: custom.description,
      icon: custom.icon,
      prompt: custom.prompt,
      builtIn: false,
    });
  }

  // Cap at MAX_SUGGESTIONS
  return Array.from(byId.values()).slice(0, MAX_SUGGESTIONS);
}
