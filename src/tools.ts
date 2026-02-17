/**
 * Shared tool description helpers
 *
 * Used by both ClaudeProcess (live streaming) and InstanceManager (JSONL replay)
 * to generate human-readable descriptions of Claude tool usage.
 */

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
    default:
      return undefined;
  }
}
