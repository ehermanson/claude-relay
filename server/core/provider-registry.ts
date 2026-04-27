import { EventEmitter } from "node:events";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CoreConfig } from "#core/config.js";
import { ClaudeProcess } from "#core/claude-process.js";
import {
  DEFAULT_PROVIDER_CAPABILITIES,
  getBuiltinProviderModels,
  getProviderDisplayName,
} from "#core/provider-catalog.js";
import type { ProviderSession } from "#core/provider.js";
import type {
  FileChange,
  HistoryEntry,
  ProviderCapabilities,
  ProviderDescriptor,
  ProviderKind,
  ProviderModelOption,
  ProviderModelOptions,
  ProviderRuntimeMode,
  ProviderSessionBootstrap,
  ProviderRuntimeBinding,
  SessionStats,
  TaskItem,
} from "#core/types.js";
import { createSdkSessionSync, getSdkDiscoveredModels } from "#core/providers/claude-sdk.js";
import { isClaudeInstalled } from "#core/providers/claude-cli.js";
import { isCodexInstalled } from "#core/providers/codex-cli.js";
import { discoverCodexModels, getCachedCodexModels } from "#core/providers/codex-models.js";
import { CodexAppServerSession } from "#core/providers/codex-app-server.js";
import { findCodexTranscriptPath, parseCodexTranscript } from "#core/providers/codex-transcript.js";
import {
  isGitWorktree,
  isRelayWorktreePath,
  resolveAnyWorktreeOrigin,
  resolveWorktreeOrigin,
} from "#core/git.js";

const execFileAsync = promisify(execFile);

type QueryFn = ((params: { prompt: unknown; options?: unknown }) => unknown) | null;

interface ProviderTranscriptParseResult {
  cwd: string;
  history: HistoryEntry[];
  tasks: Map<string, TaskItem>;
  files: Map<string, FileChange>;
  stats: SessionStats;
}

interface ProviderDriverContext {
  providerDirs: Record<ProviderKind, string>;
  logger: CoreConfig["logger"];
  sdkQueryFn: QueryFn;
  registeredDirectories?: Set<string>;
}

interface ProviderSessionOptions {
  resumeSessionId?: string;
  model?: string;
  runtimeMode?: ProviderRuntimeMode;
  allowedTools?: string[];
  modelOptions?: ProviderModelOptions;
  bootstrapContext?: ProviderSessionBootstrap;
}

interface ProviderCaptureContext {
  proc: ProviderSession;
  binding?: ProviderRuntimeBinding;
  fallbackSessionId?: string;
  workingDirectory: string;
  providerDirs: Record<ProviderKind, string>;
}

export interface DiscoveredExternalSession {
  provider: ProviderKind;
  cwd: string;
  transcriptPath: string;
  sessionId: string;
  pid?: number;
}

export interface ProviderDiscoveryTiming {
  provider: ProviderKind;
  ms: number;
  sessionCount: number;
}

export interface LiveExternalDiscoveryResult {
  sessions: DiscoveredExternalSession[];
  timings: ProviderDiscoveryTiming[];
}

interface ProviderExternalDiscoveryContext extends ProviderDriverContext {
  excludePids: Set<number>;
  runningProcessCwds?: Map<string, Map<string, { count: number; pids: number[] }>>;
}

interface ProviderDriver {
  kind: ProviderKind;
  capabilities: ProviderCapabilities;
  isAvailable(context: ProviderDriverContext): boolean;
  createSession(
    config: CoreConfig,
    options: ProviderSessionOptions | undefined,
    context: ProviderDriverContext,
  ): ProviderSession;
  getModels(context: ProviderDriverContext): Promise<ProviderModelOption[]>;
  parseTranscript(
    filePath: string,
    parseClaudeTranscript: (filePath: string) => ProviderTranscriptParseResult,
  ): ProviderTranscriptParseResult;
  resolveManagedTranscriptPath(options: {
    providerDirs: Record<ProviderKind, string>;
    sessionId?: string;
    transcriptPath?: string;
    workingDirectory?: string;
  }): string | undefined;
  captureManagedSession(
    context: ProviderCaptureContext,
  ): { sessionId: string; transcriptPath?: string } | null;
  discoverExternalSessions?(
    context: ProviderExternalDiscoveryContext,
  ): Promise<DiscoveredExternalSession[]>;
}

const NO_SESSION_MESSAGE = "Gemini provider support is not implemented in this relay build yet.";

function resolveClaudeProjectDir(providerRoot: string, workingDirectory: string): string {
  const projectsDir = join(providerRoot, "projects");
  return join(projectsDir, workingDirectory.replace(/[^A-Za-z0-9_-]/g, "-"));
}

function findRecentJsonls(projectDir: string, count: number): string[] {
  try {
    const files = readdirSync(projectDir)
      .filter((file) => file.endsWith(".jsonl"))
      .map((file) => {
        const fullPath = join(projectDir, file);
        try {
          return { path: fullPath, mtime: statSync(fullPath).mtimeMs };
        } catch {
          return null;
        }
      })
      .filter((entry): entry is { path: string; mtime: number } => entry !== null)
      .sort((a, b) => b.mtime - a.mtime);
    return files.slice(0, count).map((entry) => entry.path);
  } catch {
    return [];
  }
}

function normalizeDiscoveryDirectory(directory: string): string {
  if (isRelayWorktreePath(directory)) {
    return resolveWorktreeOrigin(directory) ?? directory;
  }
  if (isGitWorktree(directory)) {
    return resolveAnyWorktreeOrigin(directory) ?? directory;
  }
  return directory;
}

function buildDiscoveryDirectoryCandidates(directory: string): string[] {
  const candidates = new Set<string>();
  const push = (value: string | null | undefined) => {
    if (!value) return;
    candidates.add(value);
    candidates.add(normalizeDiscoveryDirectory(value));
    if (existsSync(value)) {
      try {
        candidates.add(realpathSync(value));
      } catch {
        // best-effort canonicalization only
      }
    }
  };
  push(directory);
  return [...candidates];
}

function isRegisteredDiscoveryDirectory(
  directory: string,
  registeredDirectories?: Set<string>,
): boolean {
  if (!registeredDirectories || registeredDirectories.size === 0) return true;
  if (registeredDirectories.has(directory)) return true;
  if (existsSync(directory)) {
    try {
      if (registeredDirectories.has(realpathSync(directory))) return true;
    } catch {
      // best-effort canonicalization only
    }
  }
  for (const candidate of buildDiscoveryDirectoryCandidates(directory)) {
    if (registeredDirectories.has(candidate)) return true;
  }
  return false;
}

async function findRunningProcessCwdsAsync(
  commandName: string,
  excludePids: Set<number>,
): Promise<Map<string, { count: number; pids: number[] }>> {
  const all = await findRunningProcessCwdsByCommandAsync([commandName], excludePids);
  return all.get(commandName) ?? new Map();
}

async function findRunningProcessCwdsByCommandAsync(
  commandNames: string[],
  excludePids: Set<number>,
): Promise<Map<string, Map<string, { count: number; pids: number[] }>>> {
  const names = new Set(commandNames);
  const grouped = new Map<string, Map<string, { count: number; pids: number[] }>>();
  for (const name of names) {
    grouped.set(name, new Map());
  }

  try {
    if (names.size === 0) return grouped;

    const { stdout: psOutput } = await execFileAsync("ps", ["-eo", "pid=,comm="], {
      encoding: "utf-8",
      timeout: 5000,
    });

    const pids: number[] = [];
    const commandByPid = new Map<number, string>();
    for (const line of psOutput.split("\n")) {
      const match = line.trim().match(/^(\d+)\s+(.+)$/);
      if (!match) continue;
      const pid = parseInt(match[1], 10);
      const command = match[2].split("/").pop() ?? match[2];
      if (!names.has(command)) continue;
      if (excludePids.has(pid)) continue;
      pids.push(pid);
      commandByPid.set(pid, command);
    }

    if (pids.length === 0) return grouped;

    const BATCH_SIZE = 64;
    for (let offset = 0; offset < pids.length; offset += BATCH_SIZE) {
      const batch = pids.slice(offset, offset + BATCH_SIZE);
      const { stdout } = await execFileAsync(
        "lsof",
        ["-p", batch.join(","), "-a", "-d", "cwd", "-Fp", "-Fn"],
        { encoding: "utf-8", timeout: 5000 },
      );

      let currentPid: number | null = null;
      for (const line of stdout.split("\n")) {
        if (line.startsWith("p")) {
          const parsed = parseInt(line.slice(1), 10);
          currentPid = Number.isFinite(parsed) ? parsed : null;
          continue;
        }
        if (!line.startsWith("n/") || currentPid === null) continue;
        const command = commandByPid.get(currentPid);
        if (!command) continue;
        const cwd = line.slice(1);
        const cwdInfo =
          grouped.get(command) ?? new Map<string, { count: number; pids: number[] }>();
        const existing = cwdInfo.get(cwd) ?? { count: 0, pids: [] };
        existing.count++;
        existing.pids.push(currentPid);
        cwdInfo.set(cwd, existing);
        grouped.set(command, cwdInfo);
      }
    }
  } catch {
    return grouped;
  }

  return grouped;
}

function readCodexSessionMeta(
  filePath: string,
): { sessionId: string; cwd: string; mtime: number } | null {
  try {
    const stats = statSync(filePath);
    const cached = codexSessionMetaCache.get(filePath);
    if (cached && cached.mtime === stats.mtimeMs) {
      return cached.meta
        ? { sessionId: cached.meta.sessionId, cwd: cached.meta.cwd, mtime: cached.mtime }
        : null;
    }

    const firstLine = readFileSync(filePath, "utf-8").split("\n", 1)[0];
    if (!firstLine) return null;
    const parsed = JSON.parse(firstLine) as {
      type?: string;
      payload?: { id?: string; cwd?: string };
    };
    if (parsed.type !== "session_meta") return null;
    const sessionId = parsed.payload?.id;
    const cwd = parsed.payload?.cwd;
    if (!sessionId || !cwd) return null;
    const meta = { sessionId, cwd, mtime: stats.mtimeMs };
    codexSessionMetaCache.set(filePath, { mtime: stats.mtimeMs, meta });
    return meta;
  } catch {
    codexSessionMetaCache.set(filePath, { mtime: -1, meta: null });
    return null;
  }
}

const codexSessionMetaCache = new Map<
  string,
  { mtime: number; meta: { sessionId: string; cwd: string } | null }
>();

function findRecentCodexTranscriptsForCwds(
  codexDir: string,
  cwdCounts: Map<string, number>,
): Map<string, Array<{ path: string; sessionId: string; mtime: number }>> {
  const sessionsDir = join(codexDir, "sessions");
  const results = new Map<string, Array<{ path: string; sessionId: string; mtime: number }>>();
  for (const cwd of cwdCounts.keys()) {
    results.set(cwd, []);
  }
  if (!existsSync(sessionsDir) || cwdCounts.size === 0) return results;

  const targets = new Set(cwdCounts.keys());
  const stack = [sessionsDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) continue;

    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry);
      let isDirectory = false;
      try {
        isDirectory = statSync(fullPath).isDirectory();
      } catch {
        continue;
      }
      if (isDirectory) {
        stack.push(fullPath);
        continue;
      }
      if (!entry.endsWith(".jsonl")) continue;
      const meta = readCodexSessionMeta(fullPath);
      if (!meta || !targets.has(meta.cwd)) continue;
      const matches = results.get(meta.cwd) ?? [];
      matches.push({ path: fullPath, sessionId: meta.sessionId, mtime: meta.mtime });
      results.set(meta.cwd, matches);
    }
  }

  for (const [cwd, matches] of results) {
    matches.sort((a, b) => b.mtime - a.mtime);
    results.set(cwd, matches.slice(0, cwdCounts.get(cwd) ?? 0));
  }
  return results;
}

async function discoverClaudeExternalSessions(
  context: ProviderExternalDiscoveryContext,
): Promise<DiscoveredExternalSession[]> {
  const cwdInfoMap =
    context.runningProcessCwds?.get("claude") ??
    (await findRunningProcessCwdsAsync("claude", context.excludePids));
  const sessions: DiscoveredExternalSession[] = [];
  for (const [cwd, info] of cwdInfoMap) {
    if (!isRegisteredDiscoveryDirectory(cwd, context.registeredDirectories)) continue;
    const projectDir = resolveClaudeProjectDir(context.providerDirs.claude, cwd);
    if (!existsSync(projectDir)) continue;
    const jsonlPaths = findRecentJsonls(projectDir, info.count);
    for (let i = 0; i < jsonlPaths.length; i++) {
      const transcriptPath = jsonlPaths[i];
      const fileName = transcriptPath.split("/").pop() || "";
      sessions.push({
        provider: "claude",
        cwd,
        transcriptPath,
        sessionId: fileName.replace(".jsonl", ""),
        pid: info.pids[i],
      });
    }
  }
  return sessions;
}

async function discoverCodexExternalSessions(
  context: ProviderExternalDiscoveryContext,
): Promise<DiscoveredExternalSession[]> {
  const cwdInfoMap =
    context.runningProcessCwds?.get("codex") ??
    (await findRunningProcessCwdsAsync("codex", context.excludePids));
  const transcriptsByCwd = findRecentCodexTranscriptsForCwds(
    context.providerDirs.codex,
    new Map(Array.from(cwdInfoMap.entries()).map(([cwd, info]) => [cwd, info.count])),
  );
  const sessions: DiscoveredExternalSession[] = [];
  for (const [cwd, info] of cwdInfoMap) {
    if (!isRegisteredDiscoveryDirectory(cwd, context.registeredDirectories)) continue;
    const transcripts = transcriptsByCwd.get(cwd) ?? [];
    for (let i = 0; i < transcripts.length; i++) {
      const transcript = transcripts[i];
      sessions.push({
        provider: "codex",
        cwd,
        transcriptPath: transcript.path,
        sessionId: transcript.sessionId,
        pid: info.pids[i],
      });
    }
  }
  return sessions;
}

function createClaudeSession(
  config: CoreConfig,
  options: ProviderSessionOptions | undefined,
  context: ProviderDriverContext,
): ProviderSession {
  if (context.sdkQueryFn) {
    return createSdkSessionSync(
      {
        cwd: config.workingDirectory,
        model: options?.model,
        reasoningEffort: options?.modelOptions?.reasoningEffort,
        fastMode: options?.modelOptions?.fastMode,
        runtimeMode: options?.runtimeMode ?? config.defaultRuntimeMode,
        resumeSessionId: options?.resumeSessionId,
        logger: config.logger,
        processTimeout: config.processTimeout,
        allowedTools: options?.allowedTools,
        bootstrapContext: options?.bootstrapContext,
      },
      context.sdkQueryFn as Parameters<typeof createSdkSessionSync>[1],
    );
  }

  const proc = options?.resumeSessionId
    ? new ClaudeProcess(config, {
        resumeSessionId: options.resumeSessionId,
        model: options?.model,
        runtimeMode: options?.runtimeMode,
      })
    : new ClaudeProcess(config, {
        model: options?.model,
        runtimeMode: options?.runtimeMode,
      });

  if (options?.allowedTools) {
    for (const tool of options.allowedTools) {
      proc.addAllowedTool(tool);
    }
  }

  return proc;
}

class UnsupportedGeminiSession extends EventEmitter implements ProviderSession {
  constructor(_config: CoreConfig) {
    super();
  }

  readonly provider = "gemini" as const;
  readonly pid = undefined;
  readonly stats: SessionStats = {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
  };

  get isProcessing(): boolean {
    return false;
  }

  send(_message: string): void {
    throw new Error(NO_SESSION_MESSAGE);
  }

  interrupt(): void {}

  close(): void {}

  setModel(_model: string | null): void {}

  setRuntimeMode(_mode: ProviderRuntimeMode): void {}

  addAllowedTool(_tool: string): void {}

  getRuntimeBinding(): ProviderRuntimeBinding {
    return { provider: "gemini" };
  }

  respondToRequest(_requestId: string, _decision: "accept" | "decline"): boolean {
    return false;
  }
}

const PROVIDER_DRIVERS: Record<ProviderKind, ProviderDriver> = {
  claude: {
    kind: "claude",
    capabilities: DEFAULT_PROVIDER_CAPABILITIES.claude,
    isAvailable() {
      return isClaudeInstalled();
    },
    createSession(config, options, context) {
      return createClaudeSession(config, options, context);
    },
    async getModels() {
      const sdkModels = getSdkDiscoveredModels();

      // The SDK returns short aliases ("default", "sonnet", "haiku") rather
      // than canonical model IDs like "claude-opus-4-6". We enrich builtin
      // catalog entries with SDK capability metadata where available, and
      // surface SDK-reported extras (models not in the catalog) too.

      const builtins = getBuiltinProviderModels("claude");
      if (!sdkModels?.length) return builtins;

      // Map: alias value → SDK info (skip "default" meta-alias)
      const sdkByAlias = new Map(
        sdkModels.filter((m) => m.value !== "default").map((m) => [m.value, m]),
      );

      // Map builtin IDs to the SDK alias they correspond to. Only the *current*
      // generation model claims a short alias ("opus"/"sonnet"/"haiku") — older
      // versions keep their hardcoded catalog capabilities so they don't
      // accidentally inherit newer-gen features (e.g. higher reasoning tiers)
      // via the SDK's alias output.
      const ALIAS_MAP: Record<string, string> = {
        "claude-opus-4-7": "opus",
        "claude-sonnet-4-6": "sonnet",
        "claude-haiku-4-5-20251001": "haiku",
      };

      // Programmatic per-model capabilities — derived from SDK metadata where
      // available. This is what makes e.g. Opus 4.7's higher reasoning tier
      // surface in the UI without hardcoding it client-side.
      const claudeProviderCaps = DEFAULT_PROVIDER_CAPABILITIES.claude;
      const builtinEffortLevels = claudeProviderCaps.reasoningEffortLevels ?? [];
      const buildModelCapabilities = (
        sdkMatch: ReturnType<typeof sdkByAlias.get>,
        builtinOverride: Partial<ProviderCapabilities> | undefined,
      ): Partial<ProviderCapabilities> | undefined => {
        const override: Partial<ProviderCapabilities> = { ...(builtinOverride ?? {}) };
        if (sdkMatch) {
          if (typeof sdkMatch.supportsEffort === "boolean") {
            override.supportsReasoningEffort = sdkMatch.supportsEffort;
          }
          if (sdkMatch.supportedEffortLevels && sdkMatch.supportedEffortLevels.length > 0) {
            const allowed = new Set<string>(sdkMatch.supportedEffortLevels);
            // Use per-model levels as filter base (preserves per-model isDefault),
            // falling back to provider-level levels for SDK-only extras.
            const baseLevels = override.reasoningEffortLevels ?? builtinEffortLevels;
            const filtered = baseLevels.filter((level) => allowed.has(level.effort));
            if (filtered.length > 0) override.reasoningEffortLevels = filtered;
          }
          if (typeof sdkMatch.supportsFastMode === "boolean") {
            override.supportsFastMode = sdkMatch.supportsFastMode;
          }
        }
        return Object.keys(override).length > 0 ? override : undefined;
      };

      // Enrich builtins with SDK capability metadata. We do NOT filter the
      // list to SDK-reported aliases only — the Claude API accepts full model
      // IDs (e.g. "claude-opus-4-7") even when the SDK's supportedModels()
      // alias list doesn't enumerate them, so removing unlisted models would
      // make valid choices disappear without actually preventing session use.
      const enrichedBuiltins = builtins.map((builtin) => {
        const alias = ALIAS_MAP[builtin.id];
        const sdkMatch = alias ? sdkByAlias.get(alias) : sdkByAlias.get(builtin.id);
        const capabilities = buildModelCapabilities(sdkMatch, builtin.capabilities);

        // Catalog is the source of truth for isDefault on builtin models.
        // Overriding it from SDK detection changes what the "Default" label
        // points to, which changes what the SDK receives when no explicit
        // model is chosen — confusing when the SDK default doesn't match
        // what the catalog (and the user) expects.
        const isDefault = builtin.isDefault ?? false;

        return {
          provider: "claude" as const,
          id: builtin.id,
          label: builtin.label,
          description: sdkMatch?.description || builtin.description,
          isDefault,
          ...(capabilities ? { capabilities } : {}),
        };
      });

      // Forward-compat: surface SDK-reported models that aren't covered by
      // a builtin alias and aren't already a builtin ID. Without this, a
      // new Claude model shipped by the SDK would be invisible in Relay
      // until we updated the builtin catalog.
      const aliasValues = new Set(Object.values(ALIAS_MAP));
      const builtinIds = new Set(builtins.map((b) => b.id));
      const extras = sdkModels
        .filter(
          (m) => m.value !== "default" && !aliasValues.has(m.value) && !builtinIds.has(m.value),
        )
        .map((m) => {
          const capabilities = buildModelCapabilities(m, undefined);
          return {
            provider: "claude" as const,
            id: m.value,
            label: m.displayName || m.value,
            description: m.description || undefined,
            isDefault: false,
            ...(capabilities ? { capabilities } : {}),
          };
        });

      return [...enrichedBuiltins, ...extras];
    },
    parseTranscript(filePath, parseClaudeTranscript) {
      return parseClaudeTranscript(filePath);
    },
    resolveManagedTranscriptPath(options) {
      if (options.transcriptPath && existsSync(options.transcriptPath)) {
        return options.transcriptPath;
      }
      if (!options.sessionId || !options.workingDirectory) {
        return options.transcriptPath;
      }
      const projectDir = resolveClaudeProjectDir(
        options.providerDirs.claude,
        options.workingDirectory,
      );
      return join(projectDir, `${options.sessionId}.jsonl`);
    },
    captureManagedSession(context) {
      const binding = context.binding ?? context.proc.getRuntimeBinding();
      const runtimeSessionId = binding.providerSessionId ?? context.fallbackSessionId;
      const projectDir = resolveClaudeProjectDir(
        context.providerDirs.claude,
        context.workingDirectory,
      );
      if (!existsSync(projectDir)) {
        return runtimeSessionId ? { sessionId: runtimeSessionId } : null;
      }

      if (runtimeSessionId) {
        const jsonlPath = join(projectDir, `${runtimeSessionId}.jsonl`);
        if (existsSync(jsonlPath)) {
          return { sessionId: runtimeSessionId, transcriptPath: jsonlPath };
        }
      }

      const files = readdirSync(projectDir)
        .filter((file) => file.endsWith(".jsonl"))
        .map((file) => {
          const fullPath = join(projectDir, file);
          try {
            return { path: fullPath, mtime: statSync(fullPath).mtimeMs };
          } catch {
            return null;
          }
        })
        .filter((entry): entry is { path: string; mtime: number } => entry !== null)
        .sort((a, b) => b.mtime - a.mtime);

      if (files.length === 0) {
        return runtimeSessionId ? { sessionId: runtimeSessionId } : null;
      }

      const newest = files[0];
      const fileName = newest.path.split("/").pop() || "";
      return {
        sessionId: runtimeSessionId ?? fileName.replace(".jsonl", ""),
        transcriptPath: newest.path,
      };
    },
    discoverExternalSessions(context) {
      return discoverClaudeExternalSessions(context);
    },
  },
  codex: {
    kind: "codex",
    capabilities: DEFAULT_PROVIDER_CAPABILITIES.codex,
    isAvailable() {
      return isCodexInstalled();
    },
    createSession(config, options) {
      return new CodexAppServerSession({
        cwd: config.workingDirectory,
        model: options?.model,
        runtimeMode: options?.runtimeMode ?? config.defaultRuntimeMode,
        resumeSessionId: options?.resumeSessionId,
        logger: config.logger,
        processTimeout: config.processTimeout,
        modelOptions: options?.modelOptions,
        bootstrapContext: options?.bootstrapContext,
      });
    },
    async getModels(context) {
      // Prefer the pre-warm cache populated at server boot so the first
      // /api/provider-models?provider=codex hit doesn't pay the cost of
      // spawning `codex app-server`. Falls through to a live probe if the
      // pre-warm hasn't completed yet (or the binary wasn't present at boot).
      const discovered =
        getCachedCodexModels() ?? (await discoverCodexModels({ logger: context.logger }));
      if (discovered.length === 0) {
        return getBuiltinProviderModels("codex");
      }

      // Discovered list is canonical — new models the Codex binary reports
      // should surface even if we haven't added them to the builtin catalog.
      // Builtins still contribute polished labels + any per-model capability
      // overrides (Codex JSON-RPC doesn't expose capability metadata today).
      const builtinById = new Map(
        getBuiltinProviderModels("codex").map((model) => [model.id, model]),
      );
      // Default resolution: trust the binary's `isDefault` if any model is
      // marked. Otherwise fall back to our builtin catalog's default mark so
      // a predictable model (e.g. gpt-5.4) is selected. Without this, Codex
      // binaries that don't report `isDefault` would leave no model marked,
      // and `resolveProviderDefaultModelOption` would fall through to
      // `candidateModels[0]` — whatever the binary happened to list first.
      const discoveredHasDefault = discovered.some((model) => model.isDefault);
      return discovered.map((model) => {
        const builtin = builtinById.get(model.id);
        if (!builtin) return model;
        const isDefault = discoveredHasDefault
          ? model.isDefault
          : (builtin.isDefault ?? model.isDefault);
        return {
          ...model,
          label: builtin.label || model.label,
          description: model.description ?? builtin.description,
          // Prefer discovered metadata where available; fall back to builtin.
          hidden: model.hidden ?? builtin.hidden,
          isDefault,
          availabilityNote: model.availabilityNote ?? builtin.availabilityNote,
          upgradeTo: model.upgradeTo ?? builtin.upgradeTo,
          ...(builtin.capabilities ? { capabilities: builtin.capabilities } : {}),
        };
      });
    },
    parseTranscript(filePath) {
      const parsed = parseCodexTranscript(filePath);
      return {
        cwd: parsed.cwd,
        history: parsed.history,
        tasks: parsed.tasks,
        files: parsed.files,
        stats: parsed.stats,
      };
    },
    resolveManagedTranscriptPath(options) {
      if (options.transcriptPath && existsSync(options.transcriptPath)) {
        return options.transcriptPath;
      }
      if (!options.sessionId) {
        return options.transcriptPath;
      }
      return (
        findCodexTranscriptPath(options.providerDirs.codex, options.sessionId) ??
        options.transcriptPath
      );
    },
    captureManagedSession(context) {
      const binding = context.binding ?? context.proc.getRuntimeBinding();
      const sessionId = binding.providerSessionId ?? context.fallbackSessionId;
      if (!sessionId) {
        return null;
      }
      return {
        sessionId,
        transcriptPath:
          findCodexTranscriptPath(context.providerDirs.codex, sessionId) ?? binding.transcriptPath,
      };
    },
    discoverExternalSessions(context) {
      return discoverCodexExternalSessions(context);
    },
  },
  gemini: {
    kind: "gemini",
    capabilities: DEFAULT_PROVIDER_CAPABILITIES.gemini,
    isAvailable() {
      return false;
    },
    createSession(config) {
      return new UnsupportedGeminiSession(config);
    },
    async getModels() {
      return getBuiltinProviderModels("gemini");
    },
    parseTranscript(filePath, parseClaudeTranscript) {
      return parseClaudeTranscript(filePath);
    },
    resolveManagedTranscriptPath(options) {
      return options.transcriptPath;
    },
    captureManagedSession(context) {
      const binding = context.binding ?? context.proc.getRuntimeBinding();
      const sessionId = binding.providerSessionId ?? context.fallbackSessionId;
      return sessionId ? { sessionId, transcriptPath: binding.transcriptPath } : null;
    },
  },
};

export function getProviderDriver(provider: ProviderKind): ProviderDriver {
  return PROVIDER_DRIVERS[provider];
}

export function isProviderAvailable(
  provider: ProviderKind,
  context: ProviderDriverContext,
): boolean {
  return getProviderDriver(provider).isAvailable(context);
}

export function listAvailableProviders(context: ProviderDriverContext): ProviderDescriptor[] {
  // Testing override: set RELAY_HIDE_PROVIDERS=1 to simulate no providers installed
  if (process.env.RELAY_HIDE_PROVIDERS === "1") {
    return [];
  }

  return (Object.keys(PROVIDER_DRIVERS) as ProviderKind[])
    .filter((provider) => isProviderAvailable(provider, context))
    .map((provider) => ({
      provider,
      label: getProviderDisplayName(provider),
      capabilities: getProviderCapabilities(provider),
    }));
}

export async function getProviderModels(
  provider: ProviderKind,
  context: ProviderDriverContext,
): Promise<ProviderModelOption[]> {
  return getProviderDriver(provider).getModels(context);
}

export function getProviderCapabilities(provider: ProviderKind): ProviderCapabilities {
  // Return static provider-level defaults. Per-model capability overrides
  // (derived from SDK discovery in getModels()) are applied via
  // mergeCapabilities() in the route — this avoids leaking capabilities from
  // one model onto another through provider-level aggregation.
  return getProviderDriver(provider).capabilities;
}

export function createManagedProviderSession(
  provider: ProviderKind,
  config: CoreConfig,
  options: ProviderSessionOptions | undefined,
  context: ProviderDriverContext,
): ProviderSession {
  const driver = getProviderDriver(provider);
  if (!driver.isAvailable(context)) {
    const binary =
      provider === "codex"
        ? "Codex CLI"
        : provider === "gemini"
          ? "Gemini CLI"
          : getProviderDisplayName(provider);
    throw new Error(`${binary} is not available on this machine`);
  }
  return driver.createSession(config, options, context);
}

export function resolveManagedTranscriptPathForProvider(
  provider: ProviderKind,
  options: Parameters<ProviderDriver["resolveManagedTranscriptPath"]>[0],
): string | undefined {
  return getProviderDriver(provider).resolveManagedTranscriptPath(options);
}

export function parseTranscriptForProvider(
  provider: ProviderKind,
  filePath: string,
  parseClaudeTranscript: (filePath: string) => ProviderTranscriptParseResult,
): ProviderTranscriptParseResult {
  return getProviderDriver(provider).parseTranscript(filePath, parseClaudeTranscript);
}

export function captureManagedSessionForProvider(
  provider: ProviderKind,
  context: ProviderCaptureContext,
): { sessionId: string; transcriptPath?: string } | null {
  return getProviderDriver(provider).captureManagedSession(context);
}

export async function discoverLiveExternalSessions(
  context: ProviderDriverContext,
  excludePids: Set<number>,
): Promise<LiveExternalDiscoveryResult> {
  const activeProviders = getRegisteredProviders().filter((provider) => {
    const driver = getProviderDriver(provider);
    return driver.discoverExternalSessions && driver.isAvailable(context);
  });
  const processCommands = activeProviders.flatMap((provider) => {
    if (provider === "claude") return ["claude"];
    if (provider === "codex") return ["codex"];
    return [];
  });
  const runningProcessCwds = await findRunningProcessCwdsByCommandAsync(
    processCommands,
    excludePids,
  );

  const results = await Promise.all(
    activeProviders.map(async (provider) => {
      const driver = getProviderDriver(provider);
      const startedAt = performance.now();
      const sessions = await driver.discoverExternalSessions!({
        ...context,
        excludePids,
        runningProcessCwds,
      });
      return {
        provider,
        sessions,
        ms: performance.now() - startedAt,
      };
    }),
  );
  return {
    sessions: results.flatMap((result) => result.sessions),
    timings: results.map((result) => ({
      provider: result.provider,
      ms: result.ms,
      sessionCount: result.sessions.length,
    })),
  };
}

export function getRegisteredProviders(): ProviderKind[] {
  return Object.keys(PROVIDER_DRIVERS) as ProviderKind[];
}
