import { isAbsolute, relative, resolve } from "path";

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

/**
 * Returns true when a tracked file path belongs to the current workspace.
 * Relative paths are treated as workspace-relative. Absolute paths must
 * resolve inside the workspace root.
 */
export function isPathWithinWorkspace(root: string, filePath: string): boolean {
  if (!root || !filePath) return false;

  const resolvedRoot = resolve(root);
  const resolvedPath = isAbsolute(filePath) ? resolve(filePath) : resolve(resolvedRoot, filePath);
  const rel = normalizePath(relative(resolvedRoot, resolvedPath));

  return rel === "" || (rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel));
}
