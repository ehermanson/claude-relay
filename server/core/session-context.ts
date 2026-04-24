import type {
  ProviderContextBlock,
  ProviderSessionBootstrap,
  ProviderSessionContext,
} from "#core/types.js";

export const TASK_CONTEXT_BLOCK_KIND = "task_guidance";
export const CUSTOM_INSTRUCTIONS_BLOCK_KIND = "custom_instructions";
export const SPACE_CONTEXT_BLOCK_KIND = "space_context";
export const RUNTIME_CONTEXT_PREFIX = "Runtime context for this turn:";

export const TASK_CONTEXT_MSG =
  "This project tracks tasks in .relay/tasks.json (Relay-managed snapshot JSON). " +
  "Do not create a task for every request. Create a task only when explicitly asked, pick up an existing task when explicitly asked or when the request clearly matches one, and otherwise just do the work without creating a new task. Ask if unsure whether a request should map to a task. " +
  "Fields: id (8-char hex), title, description (markdown), status (open|in_progress|done), " +
  "priority (0-4), type (epic|task|bug), tags (string[]), parent (nullable task ID), " +
  "blockedBy (task ID[]), createdAt, updatedAt (ISO timestamps). " +
  "Blocked status is auto-derived from unresolved blockedBy refs. " +
  "When asked to pick up a task (e.g. 'pick up task a1b2c3d4'), read .relay/tasks.json to find it.";

const TASK_CONTEXT_FOLLOWUP =
  "Do not mention, restate, or acknowledge the task-tracking guidance unless the user directly asks about tasks.";

function renderBlocks(
  title: string,
  blocks: ProviderContextBlock[],
  preface?: string,
): string | undefined {
  if (blocks.length === 0) return undefined;
  const sections = blocks.map((block) => {
    const header = block.source ? `## ${block.title} (${block.source})` : `## ${block.title}`;
    return `${header}\n${block.text.trim()}`;
  });
  return [title, preface, ...sections].filter(Boolean).join("\n\n");
}

export function buildSessionBootstrapContext(options: {
  customInstructionBlocks?: ProviderContextBlock[];
  relayInstructionBlocks?: ProviderContextBlock[];
  includeTaskContext?: boolean;
}): ProviderSessionBootstrap | undefined {
  const customInstructionBlocks = options.customInstructionBlocks ?? [];
  const relayInstructionBlocks = options.relayInstructionBlocks ?? [];
  const taskBlocks: ProviderContextBlock[] = options.includeTaskContext
    ? [
        {
          key: "tasks-json-guidance",
          kind: TASK_CONTEXT_BLOCK_KIND,
          title: "Task tracking guidance",
          source: ".relay/tasks.json",
          text: `${TASK_CONTEXT_MSG}\n\n${TASK_CONTEXT_FOLLOWUP}`,
        },
      ]
    : [];

  const relayBlocks = [...relayInstructionBlocks, ...taskBlocks];
  const blocks = [...customInstructionBlocks, ...relayBlocks];
  if (blocks.length === 0) return undefined;

  return {
    blocks,
    baseInstructions: renderBlocks(
      "Follow the project and user instructions below. These override Relay defaults when they conflict.",
      customInstructionBlocks,
    ),
    developerInstructions: renderBlocks("Relay-specific session guidance:", relayBlocks),
  };
}

export function getSessionContextFromRuntimePayload(
  runtimePayload: Record<string, unknown> | undefined,
): ProviderSessionContext | undefined {
  const value = runtimePayload?.sessionContext;
  if (!value || typeof value !== "object") return undefined;
  return value as ProviderSessionContext;
}

export function hasSessionBootstrapBlock(
  context: ProviderSessionContext | undefined,
  kind: string,
): boolean {
  return !!context?.bootstrap?.blocks.some((block) => block.kind === kind);
}
