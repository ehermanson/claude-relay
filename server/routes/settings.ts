import type { Hono } from "hono";
import { readJsonBody } from "#server/hono-utils.js";
import type { AppEnv, HttpDeps } from "#server/route-types.js";
import type { GlobalSettings } from "#core/types.js";

function rowToSettings(row: {
  theme: string;
  default_open_target: string | null;
  default_provider: string | null;
  default_model: string | null;
  default_space_branch: string | null;
  space_branch_source: string;
  provider_defaults_json: string | null;
  custom_instructions: string | null;
  project_order_json: string | null;
}): GlobalSettings {
  let providerDefaults: Record<string, unknown> = {};
  if (row.provider_defaults_json) {
    try {
      providerDefaults = JSON.parse(row.provider_defaults_json);
    } catch {}
  }
  let projectOrder: string[] | null = null;
  if (row.project_order_json) {
    try {
      projectOrder = JSON.parse(row.project_order_json) as string[];
    } catch {}
  }
  return {
    theme: row.theme === "light" ? "light" : row.theme === "system" ? "system" : "dark",
    defaultOpenTarget: row.default_open_target,
    defaultProvider: row.default_provider,
    defaultModel: row.default_model,
    defaultSpaceBranch: row.default_space_branch,
    spaceBranchSource: (row.space_branch_source as "local" | "remote") ?? "local",
    providerDefaults: providerDefaults as GlobalSettings["providerDefaults"],
    customInstructions: row.custom_instructions,
    projectOrder,
  };
}

export function registerSettingsRoutes(app: Hono<AppEnv>, deps: HttpDeps): void {
  const { instanceManager } = deps;

  app.get("/api/settings", (c) => {
    const row = instanceManager.sessionDb.getGlobalSettings();
    return c.json(rowToSettings(row));
  });

  app.patch("/api/settings", async (c) => {
    const body = await readJsonBody<Partial<GlobalSettings>>(c);
    if (!body) return c.json({ error: "Invalid JSON body" }, 400);

    const dbPatch: Record<string, unknown> = {};
    if (body.theme !== undefined) dbPatch.theme = body.theme;
    if (body.defaultOpenTarget !== undefined) dbPatch.default_open_target = body.defaultOpenTarget;
    if (body.defaultProvider !== undefined) dbPatch.default_provider = body.defaultProvider;
    if (body.defaultModel !== undefined) dbPatch.default_model = body.defaultModel;
    if (body.defaultSpaceBranch !== undefined)
      dbPatch.default_space_branch = body.defaultSpaceBranch;
    if (body.spaceBranchSource !== undefined) dbPatch.space_branch_source = body.spaceBranchSource;
    if (body.customInstructions !== undefined)
      dbPatch.custom_instructions = body.customInstructions;

    if (body.projectOrder !== undefined)
      dbPatch.project_order_json =
        body.projectOrder !== null ? JSON.stringify(body.projectOrder) : null;

    if (body.providerDefaults !== undefined) {
      const existing = instanceManager.sessionDb.getGlobalSettings();
      let current: Record<string, unknown> = {};
      if (existing.provider_defaults_json) {
        try {
          current = JSON.parse(existing.provider_defaults_json);
        } catch {}
      }
      const merged = { ...current, ...body.providerDefaults };
      dbPatch.provider_defaults_json = JSON.stringify(merged);
    }

    const updated = instanceManager.sessionDb.updateGlobalSettings(dbPatch);
    return c.json(rowToSettings(updated));
  });
}
