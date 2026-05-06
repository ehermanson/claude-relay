import type {
  DiscoveredExternalSession,
  ProviderDiscoveryTiming,
} from "#core/provider-registry.js";

export interface DiscoveryPollStats {
  externalSessionCount: number;
  activeSessionCount: number;
  staleCheckedCount: number;
  endedCount: number;
  providerTimings: ProviderDiscoveryTiming[];
}

export function emptyDiscoveryPollStats(): DiscoveryPollStats {
  return {
    externalSessionCount: 0,
    activeSessionCount: 0,
    staleCheckedCount: 0,
    endedCount: 0,
    providerTimings: [],
  };
}

export function normalizeDiscoveryResult(
  rawDiscovery:
    | DiscoveredExternalSession[]
    | { sessions: DiscoveredExternalSession[]; timings: ProviderDiscoveryTiming[] },
): {
  sessions: DiscoveredExternalSession[];
  timings: ProviderDiscoveryTiming[];
} {
  return Array.isArray(rawDiscovery) ? { sessions: rawDiscovery, timings: [] } : rawDiscovery;
}

export function collectActiveExternalSessions(options: {
  sessions: DiscoveredExternalSession[];
  managedProviderSessionIds: Set<string>;
  isRegisteredProject: (cwd: string) => boolean;
}): Map<string, DiscoveredExternalSession> {
  const activeSessions = new Map<string, DiscoveredExternalSession>();
  for (const session of options.sessions) {
    if (!options.isRegisteredProject(session.cwd)) {
      continue;
    }
    if (options.managedProviderSessionIds.has(session.sessionId)) {
      continue;
    }
    activeSessions.set(session.transcriptPath, session);
  }
  return activeSessions;
}

export function buildKnownJsonlMap(options: {
  instances: Array<{
    id: string;
    externalJsonlPath?: string;
    jsonlPath?: string;
  }>;
  managedTranscriptPaths: Set<string>;
}): Map<string, string> {
  const knownJsonls = new Map<string, string>();
  for (const instance of options.instances) {
    if (instance.externalJsonlPath) {
      knownJsonls.set(instance.externalJsonlPath, instance.id);
    }
    if (instance.jsonlPath) {
      knownJsonls.set(instance.jsonlPath, instance.id);
    }
  }
  for (const managedPath of options.managedTranscriptPaths) {
    if (!knownJsonls.has(managedPath)) {
      knownJsonls.set(managedPath, "__reserved_managed__");
    }
  }
  return knownJsonls;
}

export function formatSlowDiscoveryWarning(options: {
  totalMs: number;
  discoverMs: number;
  stats: DiscoveryPollStats;
  gitRefreshMs: number;
  gitRefreshCount: number;
}): string {
  const parts = [
    `[Discover] slow: ${options.totalMs.toFixed(0)}ms`,
    `discover=${options.discoverMs.toFixed(0)}ms`,
    `external=${options.stats.externalSessionCount}`,
    `active=${options.stats.activeSessionCount}`,
    `staleChecks=${options.stats.staleCheckedCount}`,
  ];
  if (options.stats.endedCount > 0) {
    parts.push(`ended=${options.stats.endedCount}`);
  }
  if (options.stats.providerTimings.length > 0) {
    parts.push(
      `providers=${options.stats.providerTimings
        .map((timing) => `${timing.provider}:${timing.ms.toFixed(0)}ms/${timing.sessionCount}`)
        .join(",")}`,
    );
  }
  if (options.gitRefreshCount > 0) {
    parts.push(`git=${options.gitRefreshMs.toFixed(0)}ms/${options.gitRefreshCount}`);
  }
  return parts.join(" ");
}
