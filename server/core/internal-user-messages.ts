export const AUTO_CONTINUE_MSG =
  "The relay server restarted while you were mid-turn. Please continue from where you left off.";

const TASK_CONTEXT_MSG =
  "This project tracks tasks in .relay/tasks.jsonl (append-only JSONL, one JSON object per line). " +
  "Do not create a task for every request. Create a task only when explicitly asked, pick up an existing task when explicitly asked or when the request clearly matches one, and otherwise just do the work without creating a new task. Ask if unsure whether a request should map to a task. " +
  "Fields: id (8-char hex), title, description (markdown), status (open|in_progress|done), " +
  "priority (0-4), type (epic|task|bug), tags (string[]), parent (nullable task ID), " +
  "blockedBy (task ID[]), createdAt, updatedAt (ISO timestamps). " +
  "Blocked status is auto-derived from unresolved blockedBy refs. " +
  "To create: append a new JSON line. To update: append a line with same id and changed fields. " +
  "When asked to pick up a task (e.g. 'pick up task a1b2c3d4'), read .relay/tasks.jsonl to find it.";

export function buildPermissionGrantedRetryMessage(toolLabel: string): string {
  return `Permission granted for ${toolLabel}. Please continue.`;
}

export function buildFirstTurnTaskContextPrompt(userMessage: string): string {
  return (
    `${TASK_CONTEXT_MSG}\n\n` +
    "Do not mention, restate, or acknowledge the task-tracking guidance unless the user directly asks about tasks. " +
    "Focus only on the user's request below.\n\n" +
    `User request:\n${userMessage}`
  );
}

const CUSTOM_INSTRUCTIONS_PREFIX = "Codebase and user instructions are shown below.";

export function buildCustomInstructionsPrompt(userMessage: string, instructions: string): string {
  return (
    `${CUSTOM_INSTRUCTIONS_PREFIX} Be sure to adhere to these instructions. ` +
    `IMPORTANT: These instructions OVERRIDE any default behavior and you MUST follow them exactly as written.\n\n` +
    `${instructions}\n\n` +
    `      IMPORTANT: this context may or may not be relevant to your tasks. You should not respond to this context unless it is highly relevant to your task.\n\n` +
    `User request:\n${userMessage}`
  );
}

const SPACE_CONTEXT_PREFIX = "<space-context>";

export interface SpaceContextInfo {
  spaceName: string;
  spaceContext: string;
  worktreePath: string;
  originalDirectory: string;
  siblingChats: Array<{ id: string; name: string; status: string }>;
}

export function buildSpaceContextPrompt(userMessage: string, info: SpaceContextInfo): string {
  const siblingsBlock =
    info.siblingChats.length > 0
      ? info.siblingChats.map((c) => `- "${c.name}" [chat:${c.id}] (${c.status})`).join("\n")
      : "(no other active chats)";

  return (
    `${SPACE_CONTEXT_PREFIX}\n` +
    `## Space: ${info.spaceName}\n\n` +
    `You are working in a shared Space with other chats. Your working directory is the space's git worktree:\n` +
    `  **Worktree:** \`${info.worktreePath}\`\n` +
    `  **Original project:** \`${info.originalDirectory}\`\n\n` +
    `**IMPORTANT:** All file reads, writes, and searches MUST use paths under the worktree (\`${info.worktreePath}\`), NOT the original project directory. The worktree is an isolated copy — changes made to the original project directory will NOT appear in this space.\n\n` +
    `The file \`.relay/space-context.md\` contains shared context that all chats in this Space can read.\n\n` +
    `**Other chats in this Space:**\n${siblingsBlock}\n\n` +
    `**Reading:** This file's contents are provided below and refreshed each turn. Check it for decisions, interfaces, status, and blockers recorded by sibling chats.\n\n` +
    `**Writing:** When you complete significant work, update \`.relay/space-context.md\` to record:\n` +
    `- Decisions made and their rationale\n` +
    `- Interfaces or contracts other chats may depend on\n` +
    `- Current status of your work\n` +
    `- Blockers or questions for sibling chats\n\n` +
    `Prefer appending new sections over rewriting existing content. Keep entries concise — this is a coordination tool, not a log of everything you did.\n\n` +
    `**Current shared context:**\n\`\`\`markdown\n${info.spaceContext}\n\`\`\`\n` +
    `</space-context>\n\n` +
    `User request:\n${userMessage}`
  );
}

export function isInternalInjectedUserText(text: string): boolean {
  return (
    text === AUTO_CONTINUE_MSG ||
    text.startsWith(TASK_CONTEXT_MSG) ||
    text.startsWith(CUSTOM_INSTRUCTIONS_PREFIX) ||
    text.startsWith(SPACE_CONTEXT_PREFIX) ||
    /^Permission granted for .+\. Please continue\.$/.test(text)
  );
}

const USER_REQUEST_MARKER = "User request:\n";

/**
 * If `text` is a wrapped internal message (task context / custom instructions),
 * extract and return the real user request embedded inside it.
 * Returns the original text unchanged if no wrapper is detected.
 */
export function stripInjectedWrapper(text: string): string {
  if (
    text.startsWith(TASK_CONTEXT_MSG) ||
    text.startsWith(CUSTOM_INSTRUCTIONS_PREFIX) ||
    text.startsWith(SPACE_CONTEXT_PREFIX)
  ) {
    const idx = text.lastIndexOf(USER_REQUEST_MARKER);
    if (idx !== -1) {
      const inner = text.slice(idx + USER_REQUEST_MARKER.length);
      if (inner) return inner;
    }
  }
  return text;
}
