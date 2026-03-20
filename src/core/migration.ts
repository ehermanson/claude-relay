import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { execFileSync } from "child_process";
import { homedir, tmpdir } from "os";
import { basename, dirname, join, relative, resolve } from "path";
import Database from "better-sqlite3";
import type { CoreConfig } from "./config.js";
import type { Logger } from "./logger.js";
import { noopLogger } from "./logger.js";
import {
  SessionDB,
  type ManagedInstanceRow,
  type ProjectRow,
  type SessionRow,
  type SpaceRow,
} from "./db.js";

const EXPORT_MANIFEST_VERSION = 1;
const RELAY_DB_RELATIVE_PATH = "relay/sessions.db";
const CLAUDE_EXPORT_RELATIVE_PATH = "providers/claude/projects";
const CODEX_EXPORT_RELATIVE_PATH = "providers/codex/sessions";

export interface MigrationConfig {
  dbPath: string;
  providerDirs?: Partial<Record<"claude" | "codex", string>>;
  logger?: Logger;
}

export interface RelayExportManifest {
  version: number;
  createdAt: string;
  sourceHome: string;
  sourceDbPath: string;
  sourceRoots: {
    claudeProjects: string;
    codexSessions: string;
  };
  bundlePaths: {
    db: string;
    claudeProjects: string;
    codexSessions: string;
  };
}

export interface RelayExportSummary {
  outputDir: string;
  manifestPath: string;
  dbIncluded: boolean;
  claudeTranscriptFiles: number;
  codexTranscriptFiles: number;
}

export interface RelayImportSummary {
  inputDir: string;
  transcriptFilesCopied: number;
  transcriptFilesUpdated: number;
  transcriptFilesSkipped: number;
  transcriptConflicts: number;
  sessionRowsMerged: number;
  managedRowsMerged: number;
  projectsMerged: number;
  spacesMerged: number;
}

export interface RelayArchiveExportSummary extends RelayExportSummary {
  archivePath: string;
}

type JsonRecord = Record<string, unknown>;

interface TranscriptMergeStats {
  copied: number;
  updated: number;
  skipped: number;
  conflicts: number;
}

interface TranscriptRewriteContext {
  sourceRoot: string;
  targetRoot: string;
  explicitMap: Map<string, string>;
}

export async function exportRelayData(
  config: MigrationConfig,
  outputDir: string,
): Promise<RelayExportSummary> {
  const resolvedOutputDir = resolve(outputDir);
  const logger = config.logger ?? noopLogger;
  const roots = resolveMigrationRoots(config);
  ensureDirIsEmptyOrMissing(resolvedOutputDir);
  mkdirSync(resolvedOutputDir, { recursive: true });

  const manifest: RelayExportManifest = {
    version: EXPORT_MANIFEST_VERSION,
    createdAt: new Date().toISOString(),
    sourceHome: homedir(),
    sourceDbPath: roots.dbPath,
    sourceRoots: {
      claudeProjects: roots.claudeProjectsDir,
      codexSessions: roots.codexSessionsDir,
    },
    bundlePaths: {
      db: RELAY_DB_RELATIVE_PATH,
      claudeProjects: CLAUDE_EXPORT_RELATIVE_PATH,
      codexSessions: CODEX_EXPORT_RELATIVE_PATH,
    },
  };

  const dbExportPath = join(resolvedOutputDir, RELAY_DB_RELATIVE_PATH);
  mkdirSync(dirname(dbExportPath), { recursive: true });
  let dbIncluded = false;
  if (existsSync(roots.dbPath)) {
    const sourceDb = new Database(roots.dbPath, { fileMustExist: true, readonly: true });
    try {
      await sourceDb.backup(dbExportPath);
      dbIncluded = true;
    } finally {
      sourceDb.close();
    }
  } else {
    logger.warn(`[migration] DB not found at ${roots.dbPath}; exporting transcripts only`);
  }

  const claudeTranscriptFiles = copyJsonlTree(
    roots.claudeProjectsDir,
    join(resolvedOutputDir, CLAUDE_EXPORT_RELATIVE_PATH),
  );
  const codexTranscriptFiles = copyJsonlTree(
    roots.codexSessionsDir,
    join(resolvedOutputDir, CODEX_EXPORT_RELATIVE_PATH),
  );

  const manifestPath = join(resolvedOutputDir, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");

  return {
    outputDir: resolvedOutputDir,
    manifestPath,
    dbIncluded,
    claudeTranscriptFiles,
    codexTranscriptFiles,
  };
}

export async function exportRelayArchive(
  config: MigrationConfig,
  archivePath: string,
): Promise<RelayArchiveExportSummary> {
  ensureTarAvailable();
  const resolvedArchivePath = resolve(archivePath);
  if (existsSync(resolvedArchivePath)) {
    throw new Error(`Archive already exists: ${resolvedArchivePath}`);
  }

  const tempRoot = mkdtempSync(join(tmpdir(), "relay-export-"));
  const bundleDir = join(tempRoot, "bundle");
  try {
    const summary = await exportRelayData(config, bundleDir);
    mkdirSync(dirname(resolvedArchivePath), { recursive: true });
    execFileSync("tar", ["-czf", resolvedArchivePath, "-C", bundleDir, "."], {
      stdio: "pipe",
    });
    return {
      ...summary,
      archivePath: resolvedArchivePath,
    };
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

export function importRelayData(config: MigrationConfig, inputDir: string): RelayImportSummary {
  const resolvedInputDir = resolve(inputDir);
  const logger = config.logger ?? noopLogger;
  const roots = resolveMigrationRoots(config);
  const manifest = readExportManifest(resolvedInputDir);

  const claudeRewrite: TranscriptRewriteContext = {
    sourceRoot: manifest.sourceRoots.claudeProjects,
    targetRoot: roots.claudeProjectsDir,
    explicitMap: new Map(),
  };
  const codexRewrite: TranscriptRewriteContext = {
    sourceRoot: manifest.sourceRoots.codexSessions,
    targetRoot: roots.codexSessionsDir,
    explicitMap: new Map(),
  };

  const transcriptStats = mergeTranscriptTrees(
    [
      {
        bundleRoot: join(resolvedInputDir, manifest.bundlePaths.claudeProjects),
        sourceRoot: manifest.sourceRoots.claudeProjects,
        targetRoot: roots.claudeProjectsDir,
        rewrite: claudeRewrite,
      },
      {
        bundleRoot: join(resolvedInputDir, manifest.bundlePaths.codexSessions),
        sourceRoot: manifest.sourceRoots.codexSessions,
        targetRoot: roots.codexSessionsDir,
        rewrite: codexRewrite,
      },
    ],
    logger,
  );

  const bundleDbPath = join(resolvedInputDir, manifest.bundlePaths.db);
  let sessionRowsMerged = 0;
  let managedRowsMerged = 0;
  let projectsMerged = 0;
  let spacesMerged = 0;

  if (existsSync(bundleDbPath)) {
    const targetDb = new SessionDB(roots.dbPath, logger);
    const sourceDb = new Database(bundleDbPath, { fileMustExist: true, readonly: true });
    try {
      const sourceProjects = sourceDb.prepare("SELECT * FROM projects").all() as ProjectRow[];
      const projectIdMap = new Map<string, string>();
      for (const sourceProject of sourceProjects) {
        const rewrittenProject = rewriteProjectRow(sourceProject, manifest.sourceHome);
        const existingProject = targetDb.getProjectByDirectory(rewrittenProject.directory);
        if (existingProject) {
          projectIdMap.set(sourceProject.id, existingProject.id);
          targetDb.upsertProject({
            ...existingProject,
            name: existingProject.name || rewrittenProject.name,
            repo_root: existingProject.repo_root ?? rewrittenProject.repo_root,
            remote_url: existingProject.remote_url ?? rewrittenProject.remote_url,
            target_branch: existingProject.target_branch ?? rewrittenProject.target_branch,
            last_activity_at: Math.max(
              existingProject.last_activity_at ?? 0,
              rewrittenProject.last_activity_at ?? 0,
            ),
          });
        } else {
          targetDb.upsertProject(rewrittenProject);
          projectIdMap.set(sourceProject.id, rewrittenProject.id);
        }
        projectsMerged++;
      }

      const sourceSpaces = sourceDb.prepare("SELECT * FROM spaces").all() as SpaceRow[];
      const spaceIdMap = new Map<string, string>();
      for (const sourceSpace of sourceSpaces) {
        const rewrittenSpace = rewriteSpaceRow(sourceSpace, manifest.sourceHome, projectIdMap);
        const projectDirectory = rewrittenSpace.project_directory;
        let targetSpace: SpaceRow | undefined;
        if (rewrittenSpace.is_default === 1) {
          targetSpace = targetDb.getDefaultSpace(projectDirectory);
        }
        if (!targetSpace) {
          targetSpace = targetDb
            .getSpacesByProject(projectDirectory)
            .find(
              (space) =>
                space.name === rewrittenSpace.name &&
                (space.git_branch ?? null) === (rewrittenSpace.git_branch ?? null) &&
                space.is_default === rewrittenSpace.is_default,
            );
        }
        if (targetSpace) {
          spaceIdMap.set(sourceSpace.id, targetSpace.id);
          targetDb.upsertSpace({
            ...targetSpace,
            name: targetSpace.name || rewrittenSpace.name,
            git_branch: targetSpace.git_branch ?? rewrittenSpace.git_branch,
            worktree_path: targetSpace.worktree_path ?? rewrittenSpace.worktree_path,
            status: targetSpace.status === "archived" ? targetSpace.status : rewrittenSpace.status,
            last_activity_at: Math.max(
              targetSpace.last_activity_at,
              rewrittenSpace.last_activity_at,
            ),
          });
        } else {
          targetDb.upsertSpace(rewrittenSpace);
          spaceIdMap.set(sourceSpace.id, rewrittenSpace.id);
        }
        spacesMerged++;
      }

      const sourceSessions = sourceDb.prepare("SELECT * FROM sessions").all() as SessionRow[];
      for (const sourceSession of sourceSessions) {
        const rewritten = rewriteSessionRow(
          sourceSession,
          manifest.sourceHome,
          [claudeRewrite, codexRewrite],
          projectIdMap,
          spaceIdMap,
        );
        targetDb.upsert(rewritten);
        sessionRowsMerged++;
      }

      const targetManaged = targetDb.getAllManagedActive();
      const sourceManaged = sourceDb
        .prepare("SELECT * FROM managed_sessions")
        .all() as ManagedInstanceRow[];
      for (const sourceManagedRow of sourceManaged) {
        const rewritten = rewriteManagedRow(
          sourceManagedRow,
          manifest.sourceHome,
          [claudeRewrite, codexRewrite],
          projectIdMap,
          spaceIdMap,
        );
        const matchedManaged =
          targetManaged.find((row) => row.instance_id === rewritten.instance_id) ??
          targetManaged.find(
            (row) =>
              row.provider_name === rewritten.provider_name &&
              row.provider_session_id === rewritten.provider_session_id &&
              row.provider_session_id !== null,
          ) ??
          targetManaged.find(
            (row) =>
              row.transcript_path !== null &&
              row.transcript_path === rewritten.transcript_path &&
              rewritten.transcript_path !== null,
          );
        if (matchedManaged) {
          rewritten.instance_id = matchedManaged.instance_id;
        }
        targetDb.upsertManaged(rewritten);
        managedRowsMerged++;
      }
    } finally {
      sourceDb.close();
      targetDb.close();
    }
  } else {
    logger.warn(`[migration] Bundle DB not found at ${bundleDbPath}; merged transcripts only`);
  }

  return {
    inputDir: resolvedInputDir,
    transcriptFilesCopied: transcriptStats.copied,
    transcriptFilesUpdated: transcriptStats.updated,
    transcriptFilesSkipped: transcriptStats.skipped,
    transcriptConflicts: transcriptStats.conflicts,
    sessionRowsMerged,
    managedRowsMerged,
    projectsMerged,
    spacesMerged,
  };
}

export function importRelayArchive(
  config: MigrationConfig,
  archivePath: string,
): RelayImportSummary {
  ensureTarAvailable();
  const resolvedArchivePath = resolve(archivePath);
  if (!existsSync(resolvedArchivePath)) {
    throw new Error(`Archive not found: ${resolvedArchivePath}`);
  }

  const extractDir = mkdtempSync(join(tmpdir(), "relay-import-"));
  try {
    execFileSync("tar", ["-xzf", resolvedArchivePath, "-C", extractDir], { stdio: "pipe" });
    return importRelayData(config, extractDir);
  } finally {
    rmSync(extractDir, { recursive: true, force: true });
  }
}

function readExportManifest(inputDir: string): RelayExportManifest {
  const manifestPath = join(inputDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`Missing manifest: ${manifestPath}`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as RelayExportManifest;
  if (manifest.version !== EXPORT_MANIFEST_VERSION) {
    throw new Error(
      `Unsupported export manifest version ${manifest.version} (expected ${EXPORT_MANIFEST_VERSION})`,
    );
  }
  return manifest;
}

function resolveMigrationRoots(config: MigrationConfig): {
  dbPath: string;
  claudeProjectsDir: string;
  codexSessionsDir: string;
} {
  const home = homedir();
  const claudeRoot = config.providerDirs?.claude ?? join(home, ".claude");
  const codexRoot = config.providerDirs?.codex ?? join(home, ".codex");
  return {
    dbPath: resolve(config.dbPath),
    claudeProjectsDir: resolve(join(claudeRoot, "projects")),
    codexSessionsDir: resolve(join(codexRoot, "sessions")),
  };
}

function ensureDirIsEmptyOrMissing(dir: string): void {
  if (!existsSync(dir)) return;
  const entries = readdirSync(dir);
  if (entries.length > 0) {
    throw new Error(`Output directory must be empty: ${dir}`);
  }
}

function ensureTarAvailable(): void {
  try {
    execFileSync("tar", ["--version"], { stdio: "pipe" });
  } catch {
    throw new Error("`tar` is required for export-tgz/import-tgz but was not found on PATH");
  }
}

function copyJsonlTree(sourceRoot: string, targetRoot: string): number {
  if (!existsSync(sourceRoot)) return 0;
  let copied = 0;
  const stack = [sourceRoot];
  while (stack.length > 0) {
    const currentDir = stack.pop();
    if (!currentDir) continue;
    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      const sourcePath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        stack.push(sourcePath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      const rel = relative(sourceRoot, sourcePath);
      const targetPath = join(targetRoot, rel);
      mkdirSync(dirname(targetPath), { recursive: true });
      copyFileSync(sourcePath, targetPath);
      copied++;
    }
  }
  return copied;
}

function mergeTranscriptTrees(
  roots: Array<{
    bundleRoot: string;
    sourceRoot: string;
    targetRoot: string;
    rewrite: TranscriptRewriteContext;
  }>,
  logger: Logger,
): TranscriptMergeStats {
  const stats: TranscriptMergeStats = { copied: 0, updated: 0, skipped: 0, conflicts: 0 };

  for (const root of roots) {
    if (!existsSync(root.bundleRoot)) continue;
    const stack = [root.bundleRoot];
    while (stack.length > 0) {
      const currentDir = stack.pop();
      if (!currentDir) continue;
      for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
        const bundlePath = join(currentDir, entry.name);
        if (entry.isDirectory()) {
          stack.push(bundlePath);
          continue;
        }
        if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;

        const rel = relative(root.bundleRoot, bundlePath);
        const oldAbsolutePath = join(root.sourceRoot, rel);
        const targetPath = join(root.targetRoot, rel);
        const action = mergeJsonlFile(bundlePath, targetPath);
        if (action === "copied") stats.copied++;
        if (action === "updated") stats.updated++;
        if (action === "skipped") stats.skipped++;
        if (action.startsWith("conflict:")) {
          stats.conflicts++;
          const conflictPath = action.slice("conflict:".length);
          root.rewrite.explicitMap.set(oldAbsolutePath, conflictPath);
          logger.warn(`[migration] Transcript conflict preserved at ${conflictPath}`);
          continue;
        }
        root.rewrite.explicitMap.set(oldAbsolutePath, targetPath);
      }
    }
  }

  return stats;
}

function mergeJsonlFile(
  incomingPath: string,
  targetPath: string,
): "copied" | "updated" | "skipped" | `conflict:${string}` {
  mkdirSync(dirname(targetPath), { recursive: true });
  if (!existsSync(targetPath)) {
    copyFileSync(incomingPath, targetPath);
    return "copied";
  }

  const incoming = readFileSync(incomingPath, "utf-8");
  const existing = readFileSync(targetPath, "utf-8");
  if (incoming === existing) return "skipped";
  if (incoming.startsWith(existing)) {
    writeFileSync(targetPath, incoming, "utf-8");
    return "updated";
  }
  if (existing.startsWith(incoming)) return "skipped";

  const conflictPath = uniqueConflictPath(targetPath);
  writeFileSync(conflictPath, incoming, "utf-8");
  return `conflict:${conflictPath}`;
}

function uniqueConflictPath(targetPath: string): string {
  const suffix = `.imported-${Date.now()}`;
  const dir = dirname(targetPath);
  const base = basename(targetPath, ".jsonl");
  let candidate = join(dir, `${base}${suffix}.jsonl`);
  let counter = 1;
  while (existsSync(candidate)) {
    candidate = join(dir, `${base}${suffix}-${counter}.jsonl`);
    counter++;
  }
  return candidate;
}

function rewriteProjectRow(row: ProjectRow, sourceHome: string): ProjectRow {
  return {
    ...row,
    directory: rewriteGeneralPath(row.directory, sourceHome),
    repo_root: rewriteNullablePath(row.repo_root, sourceHome),
  };
}

function rewriteSpaceRow(
  row: SpaceRow,
  sourceHome: string,
  _projectIdMap: Map<string, string>,
): SpaceRow {
  return {
    ...row,
    project_directory: rewriteGeneralPath(row.project_directory, sourceHome),
    worktree_path: rewriteNullablePath(row.worktree_path, sourceHome),
  };
}

function rewriteSessionRow(
  row: SessionRow,
  sourceHome: string,
  transcriptContexts: TranscriptRewriteContext[],
  projectIdMap: Map<string, string>,
  spaceIdMap: Map<string, string>,
): SessionRow {
  return {
    ...row,
    working_directory: rewriteGeneralPath(row.working_directory, sourceHome),
    jsonl_path: rewriteTranscriptPath(row.jsonl_path, transcriptContexts),
    worktree_path: rewriteNullablePath(row.worktree_path, sourceHome),
    original_directory: rewriteNullablePath(row.original_directory, sourceHome),
    project_id: rewriteMappedId(row.project_id, projectIdMap),
    space_id: rewriteMappedId(row.space_id, spaceIdMap),
  };
}

function rewriteManagedRow(
  row: ManagedInstanceRow,
  sourceHome: string,
  transcriptContexts: TranscriptRewriteContext[],
  projectIdMap: Map<string, string>,
  spaceIdMap: Map<string, string>,
): ManagedInstanceRow {
  return {
    ...row,
    working_directory: rewriteGeneralPath(row.working_directory, sourceHome),
    worktree_path: rewriteNullablePath(row.worktree_path, sourceHome),
    original_directory: rewriteNullablePath(row.original_directory, sourceHome),
    transcript_path:
      row.transcript_path === null
        ? null
        : rewriteTranscriptPath(row.transcript_path, transcriptContexts),
    runtime_payload_json: rewriteJsonPaths(
      row.runtime_payload_json,
      sourceHome,
      transcriptContexts,
    ),
    project_id: rewriteMappedId(row.project_id, projectIdMap),
    space_id: rewriteMappedId(row.space_id, spaceIdMap),
  };
}

function rewriteTranscriptPath(pathValue: string, contexts: TranscriptRewriteContext[]): string {
  for (const context of contexts) {
    const explicit = context.explicitMap.get(pathValue);
    if (explicit) return explicit;
    const mapped = rewritePathWithinRoot(pathValue, context.sourceRoot, context.targetRoot);
    if (mapped) return mapped;
  }
  return pathValue;
}

function rewriteNullablePath(pathValue: string | null, sourceHome: string): string | null {
  return pathValue === null ? null : rewriteGeneralPath(pathValue, sourceHome);
}

function rewriteGeneralPath(pathValue: string, sourceHome: string): string {
  if (!pathValue.startsWith("/")) return pathValue;
  return rewritePathWithinRoot(pathValue, sourceHome, homedir()) ?? pathValue;
}

function rewritePathWithinRoot(
  pathValue: string,
  sourceRoot: string,
  targetRoot: string,
): string | undefined {
  const normalizedRoot = resolve(sourceRoot);
  const normalizedPath = resolve(pathValue);
  if (normalizedPath !== normalizedRoot && !normalizedPath.startsWith(normalizedRoot + "/")) {
    return undefined;
  }
  const rel = relative(normalizedRoot, normalizedPath);
  return rel ? join(targetRoot, rel) : targetRoot;
}

function rewriteMappedId(value: string | null, idMap: Map<string, string>): string | null {
  if (value === null) return null;
  return idMap.get(value) ?? value;
}

function rewriteJsonPaths(
  raw: string | null,
  sourceHome: string,
  transcriptContexts: TranscriptRewriteContext[],
): string | null {
  if (!raw) return raw;
  try {
    const parsed = JSON.parse(raw) as unknown;
    const rewritten = rewriteJsonValue(parsed, sourceHome, transcriptContexts);
    return JSON.stringify(rewritten);
  } catch {
    return raw;
  }
}

function rewriteJsonValue(
  value: unknown,
  sourceHome: string,
  transcriptContexts: TranscriptRewriteContext[],
): unknown {
  if (typeof value === "string") {
    if (value.endsWith(".jsonl")) {
      return rewriteTranscriptPath(value, transcriptContexts);
    }
    return rewriteGeneralPath(value, sourceHome);
  }
  if (Array.isArray(value)) {
    return value.map((item) => rewriteJsonValue(item, sourceHome, transcriptContexts));
  }
  if (value && typeof value === "object") {
    const next: JsonRecord = {};
    for (const [key, nestedValue] of Object.entries(value as JsonRecord)) {
      next[key] = rewriteJsonValue(nestedValue, sourceHome, transcriptContexts);
    }
    return next;
  }
  return value;
}

export function createMigrationConfigFromCore(config: CoreConfig): MigrationConfig {
  return {
    dbPath: config.dbPath,
    providerDirs: {
      claude: config.providerDirs?.claude ?? config.claudeDir,
      codex: config.providerDirs?.codex ?? config.codexDir,
    },
    logger: config.logger,
  };
}

export function countJsonlFiles(root: string): number {
  if (!existsSync(root)) return 0;
  let count = 0;
  const stack = [root];
  while (stack.length > 0) {
    const currentDir = stack.pop();
    if (!currentDir) continue;
    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".jsonl") && statSync(fullPath).size >= 0) {
        count++;
      }
    }
  }
  return count;
}
