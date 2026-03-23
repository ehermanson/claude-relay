import { EventEmitter } from "node:events";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { CoreConfig } from "./config.js";
import { ClaudeProcess } from "./claude-process.js";
import {
  DEFAULT_PROVIDER_CAPABILITIES,
  getBuiltinProviderModels,
  getProviderDisplayName,
} from "./provider-catalog.js";
import type { ProviderSession } from "./provider.js";
import type {
  FileChange,
  HistoryEntry,
  ProviderCapabilities,
  ProviderDescriptor,
  ProviderKind,
  ProviderModelOption,
  ProviderModelOptions,
  ProviderRuntimeBinding,
  SessionStats,
  TaskItem,
} from "./types.js";
import { createSdkSessionSync } from "./providers/claude-sdk.js";
import { isCodexInstalled } from "./providers/codex-cli.js";
import { discoverCodexModels } from "./providers/codex-models.js";
import { CodexAppServerSession } from "./providers/codex-app-server.js";
import { findCodexTranscriptPath, parseCodexTranscript } from "./providers/codex-transcript.js";

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
}

interface ProviderSessionOptions {
  resumeSessionId?: string;
  model?: string;
  reasoningBudget?: number;
  planMode?: boolean;
  allowedTools?: string[];
  modelOptions?: ProviderModelOptions;
}

interface ProviderCaptureContext {
  proc: ProviderSession;
  binding?: ProviderRuntimeBinding;
  fallbackSessionId?: string;
  workingDirectory: string;
  providerDirs: Record<ProviderKind, string>;
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
}

const NO_SESSION_MESSAGE = "Gemini provider support is not implemented in this relay build yet.";

function getClaudeProjectDirCandidates(workingDirectory: string): string[] {
  const modern = workingDirectory.replace(/[^A-Za-z0-9_-]/g, "-");
  const legacy = workingDirectory.replace(/\//g, "-");
  return modern === legacy ? [modern] : [modern, legacy];
}

function resolveClaudeProjectDir(providerRoot: string, workingDirectory: string): string {
  const projectsDir = join(providerRoot, "projects");
  for (const encoded of getClaudeProjectDirCandidates(workingDirectory)) {
    const projectDir = join(projectsDir, encoded);
    if (existsSync(projectDir)) {
      return projectDir;
    }
  }
  return join(projectsDir, getClaudeProjectDirCandidates(workingDirectory)[0]);
}

function createClaudeSession(
  config: CoreConfig,
  options: ProviderSessionOptions | undefined,
  context: ProviderDriverContext,
): ProviderSession {
  // Canonical budget: prefer modelOptions.reasoningBudgetTokens, fall back to legacy reasoningBudget
  const budget = options?.modelOptions?.reasoningBudgetTokens ?? options?.reasoningBudget;

  if (context.sdkQueryFn) {
    return createSdkSessionSync(
      {
        cwd: config.workingDirectory,
        model: options?.model,
        maxThinkingTokens: budget,
        planMode: options?.planMode,
        resumeSessionId: options?.resumeSessionId,
        dangerouslySkipPermissions: config.dangerouslySkipPermissions,
        logger: config.logger,
        processTimeout: config.processTimeout,
        allowedTools: options?.allowedTools,
      },
      context.sdkQueryFn as Parameters<typeof createSdkSessionSync>[1],
    );
  }

  const proc = options?.resumeSessionId
    ? new ClaudeProcess(config, {
        resumeSessionId: options.resumeSessionId,
        model: options?.model,
        reasoningBudget: budget,
        planMode: options?.planMode,
      })
    : new ClaudeProcess(config, {
        model: options?.model,
        reasoningBudget: budget,
        planMode: options?.planMode,
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

  setReasoningBudget(_budget: number | null): void {}

  setPlanMode(_planMode: boolean): void {}

  addAllowedTool(_tool: string): void {}

  setBypassPermissions(_bypass: boolean): void {}

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
      return true;
    },
    createSession(config, options, context) {
      return createClaudeSession(config, options, context);
    },
    async getModels() {
      return getBuiltinProviderModels("claude");
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
        planMode: options?.planMode,
        resumeSessionId: options?.resumeSessionId,
        dangerouslySkipPermissions: config.dangerouslySkipPermissions,
        logger: config.logger,
        processTimeout: config.processTimeout,
        modelOptions: options?.modelOptions,
      });
    },
    async getModels(context) {
      const discovered = await discoverCodexModels({ logger: context.logger });
      if (discovered.length === 0) {
        return getBuiltinProviderModels("codex");
      }

      const discoveredById = new Map(discovered.map((model) => [model.id, model]));
      const merged = getBuiltinProviderModels("codex")
        .filter((model) => discoveredById.has(model.id))
        .map((model) => {
          const discoveredModel = discoveredById.get(model.id);
          return {
            ...model,
            description: discoveredModel?.description ?? model.description,
            hidden: discoveredModel?.hidden ?? model.hidden,
            isDefault: discoveredModel?.isDefault ?? model.isDefault,
            availabilityNote: discoveredModel?.availabilityNote ?? model.availabilityNote,
            upgradeTo: discoveredModel?.upgradeTo ?? model.upgradeTo,
          };
        });
      return merged.length > 0 ? merged : getBuiltinProviderModels("codex");
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
      return findCodexTranscriptPath(options.providerDirs.codex, options.sessionId);
    },
    captureManagedSession(context) {
      const binding = context.binding ?? context.proc.getRuntimeBinding();
      const sessionId = binding.providerSessionId ?? context.fallbackSessionId;
      if (!sessionId) {
        return null;
      }
      return {
        sessionId,
        transcriptPath: findCodexTranscriptPath(context.providerDirs.codex, sessionId),
      };
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
  return (Object.keys(PROVIDER_DRIVERS) as ProviderKind[])
    .filter((provider) => isProviderAvailable(provider, context))
    .map((provider) => ({
      provider,
      label: getProviderDisplayName(provider),
      capabilities: getProviderDriver(provider).capabilities,
    }));
}

export async function getProviderModels(
  provider: ProviderKind,
  context: ProviderDriverContext,
): Promise<ProviderModelOption[]> {
  return getProviderDriver(provider).getModels(context);
}

export function getProviderCapabilities(provider: ProviderKind): ProviderCapabilities {
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

export function getRegisteredProviders(): ProviderKind[] {
  return Object.keys(PROVIDER_DRIVERS) as ProviderKind[];
}
