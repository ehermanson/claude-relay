import { useQuery } from "@tanstack/react-query";
import type { ProviderDescriptor } from "@shared/types";
import { fetchProviders } from "@/lib/api";

// Server probes provider CLI versions every 30 min in the background; mirror
// that steady-state cadence on the client so a stale `versionAdvisory`
// eventually refreshes without a manual reload, while keeping request volume
// tiny.
const STEADY_REFETCH_INTERVAL_MS = 30 * 60 * 1_000;

// Bootstrap cadence: the first `GET /api/providers` typically returns before
// the server's async probe has populated any `versionAdvisory`, so the launch
// toast and settings card can't render yet. Poll quickly until at least one
// provider carries an advisory (success or "unknown" — either way the probe
// has resolved), then drop to the steady-state interval.
const BOOTSTRAP_REFETCH_INTERVAL_MS = 5_000;

function anyAdvisoryPopulated(providers: ReadonlyArray<ProviderDescriptor>): boolean {
  return providers.some((p) => p.capabilities.versionAdvisory != null);
}

export function useAvailableProviders() {
  const { data: providers = [], isLoading } = useQuery<ProviderDescriptor[]>({
    queryKey: ["providers"],
    queryFn: fetchProviders,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => {
      const data = query.state.data ?? [];
      if (data.length === 0) return BOOTSTRAP_REFETCH_INTERVAL_MS;
      return anyAdvisoryPopulated(data)
        ? STEADY_REFETCH_INTERVAL_MS
        : BOOTSTRAP_REFETCH_INTERVAL_MS;
    },
  });

  return { providers, isLoading };
}
