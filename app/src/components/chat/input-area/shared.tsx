import type { ProviderModelOption } from "@shared/types";

export const SLASH_COMMANDS = [
  {
    id: "model",
    title: "/model",
    description: "Switch the model used for the next turn",
    category: "Relay Commands",
  },
  {
    id: "reasoning",
    title: "/reasoning",
    description: "Set the reasoning effort for the next turn",
    category: "Relay Commands",
  },
  {
    id: "effort",
    title: "/effort",
    description: "Set the reasoning effort level",
    category: "Relay Commands",
  },
] as const;

export type ComposerCommandPrefix = "/" | "$";

interface CommandContext {
  prefix: ComposerCommandPrefix;
  commandQuery: string;
  argQuery: string;
  hasArgument: boolean;
}

export interface SlashMenuItem {
  key: string;
  category: string;
  title: string;
  description: string;
  commandText?: string;
  hint?: string;
  actionHint?: string;
  accent?: boolean;
  onSelect: () => void;
}

export type MentionEntry =
  | { kind: "file" | "directory"; path: string }
  | {
      kind: "task";
      taskId: string;
      title: string;
      description: string;
      priority: number;
      type: string;
    };

export function mentionEntryKey(entry: MentionEntry): string {
  return entry.kind === "task" ? `task:${entry.taskId}` : entry.path;
}

export interface ImageAttachment {
  file: File;
  preview: string;
}

export function getCommandContext(text: string): CommandContext | null {
  const normalized = text.trimStart();
  const prefix = normalized[0] as ComposerCommandPrefix | undefined;
  if ((prefix !== "/" && prefix !== "$") || normalized.includes("\n")) return null;

  const body = normalized.slice(1);
  const firstWhitespace = body.search(/\s/);
  if (firstWhitespace === -1) {
    return {
      prefix,
      commandQuery: body.toLowerCase(),
      argQuery: "",
      hasArgument: false,
    };
  }

  return {
    prefix,
    commandQuery: body.slice(0, firstWhitespace).toLowerCase(),
    argQuery: body
      .slice(firstWhitespace + 1)
      .trimStart()
      .toLowerCase(),
    hasArgument: true,
  };
}

export function matchesQuery(query: string, values: readonly string[]): boolean {
  if (!query) return true;
  return values.some((value) => value.includes(query));
}

export function buildModelLabelLookup(models: readonly ProviderModelOption[]): Map<string, string> {
  return new Map(models.map((model) => [model.id, model.label]));
}
