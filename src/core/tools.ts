/**
 * Shared tool description helpers
 *
 * Used by both ClaudeProcess (live streaming) and InstanceManager (JSONL replay)
 * to generate human-readable descriptions of Claude tool usage.
 */

/**
 * Check if a tool_result error message is a permission denial.
 * Returns true for known denial formats, false otherwise.
 *
 * Known formats:
 * - "Claude requested permissions to Bash(npm install), but you haven't granted it yet."
 * - "Claude requested permissions to write to /path/file.md, but you haven't granted it yet."
 * - "This command requires approval"
 *
 * The tool name is NOT extracted here — callers should use the preceding tool_use
 * event's tool name, which is always available.
 */
export function isPermissionDenial(content: string): boolean {
  return (
    content.includes("haven't granted it yet") ||
    content.includes("requires approval")
  );
}

export function describeToolUse(
  tool: string,
  input?: Record<string, unknown>
): string {
  if (!input) return `Using ${tool}`;

  switch (tool) {
    case "Read":
      return "Reading file";
    case "Edit":
      return "Editing file";
    case "Write":
      return "Writing file";
    case "Bash":
      return "Running command";
    case "Glob":
      return "Searching files";
    case "Grep":
      return "Searching content";
    case "WebFetch":
      return "Fetching URL";
    case "WebSearch":
      return "Searching web";
    case "Task":
      return "Running subtask";
    case "EnterPlanMode":
      return "Entering plan mode";
    case "ExitPlanMode":
      return "Plan ready";
    case "AskUserQuestion":
      return "Question";
    default:
      return `Using ${tool}`;
  }
}

export function describeToolDetail(
  tool: string,
  input?: Record<string, unknown>
): string | undefined {
  if (!input) return undefined;

  switch (tool) {
    case "Read":
    case "Edit":
    case "Write":
      return (input.file_path as string) || (input.path as string);
    case "Bash": {
      const cmd = input.command as string;
      return cmd
        ? cmd.length > 100
          ? cmd.slice(0, 100) + "..."
          : cmd
        : undefined;
    }
    case "Glob":
    case "Grep":
      return input.pattern as string;
    case "WebFetch":
      return input.url as string;
    case "WebSearch":
      return input.query as string;
    case "ExitPlanMode": {
      const plan = input.plan as string;
      if (!plan) return undefined;
      const firstLine = plan.split("\n").find((l: string) => l.trim());
      return firstLine?.replace(/^#+\s*/, "").trim();
    }
    case "AskUserQuestion": {
      const questions = input.questions as Array<{ question?: string }> | undefined;
      if (questions?.[0]?.question) return questions[0].question;
      return undefined;
    }
    default:
      return undefined;
  }
}
