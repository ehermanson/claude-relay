/**
 * Shared path helpers used by both server and UI.
 * Keep this file free of node-specific imports so the app can consume it via @shared/paths.
 */

/** Extract the file extension without the dot (e.g. "ts"), or undefined if none. */
export function extFromPath(filePath: string): string | undefined {
  const dot = filePath.lastIndexOf(".");
  if (dot < 0 || dot === filePath.length - 1) return undefined;
  const ext = filePath.slice(dot + 1);
  // Guard against paths like "src/dir.name/file" where the dot is in a directory
  if (ext.includes("/") || ext.includes("\\")) return undefined;
  return ext.toLowerCase();
}
