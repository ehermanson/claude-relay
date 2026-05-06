import type { ManagedInstanceRow, SessionRow } from "#core/db.js";
import type { ManagedSessionKeys } from "#core/managed-session-identity.js";

export function restorePersistedRows(options: {
  externalRows: SessionRow[];
  managedRows: ManagedInstanceRow[];
  managedKeys: ManagedSessionKeys;
  isManagedShadowSessionRow: (row: SessionRow, managedKeys: ManagedSessionKeys) => boolean;
  restoreExternalRow: (row: SessionRow) => boolean;
  restoreManagedRow: (row: ManagedInstanceRow) => boolean;
}): number {
  let restored = 0;

  for (const entry of options.externalRows) {
    if (options.isManagedShadowSessionRow(entry, options.managedKeys)) continue;
    if (options.restoreExternalRow(entry)) restored++;
  }

  for (const entry of options.managedRows) {
    if (options.restoreManagedRow(entry)) restored++;
  }

  return restored;
}
