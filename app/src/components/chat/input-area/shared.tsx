import type { ProviderModelOption } from "@shared/types";

export const SLASH_COMMANDS = [
  {
    id: "model",
    title: "/model",
    description: "Switch the model used for the next turn",
    category: "Command",
  },
  {
    id: "reasoning",
    title: "/reasoning",
    description: "Set the reasoning effort for the next turn",
    category: "Command",
  },
  {
    id: "effort",
    title: "/effort",
    description: "Set the reasoning effort level",
    category: "Command",
  },
] as const;

interface SlashContext {
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

export interface MentionEntry {
  path: string;
  kind: "file" | "directory";
}

export interface ImageAttachment {
  file: File;
  preview: string;
}

export function getSlashContext(text: string): SlashContext | null {
  const normalized = text.trimStart();
  if (!normalized.startsWith("/") || normalized.includes("\n")) return null;

  const body = normalized.slice(1);
  const firstWhitespace = body.search(/\s/);
  if (firstWhitespace === -1) {
    return {
      commandQuery: body.toLowerCase(),
      argQuery: "",
      hasArgument: false,
    };
  }

  return {
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
