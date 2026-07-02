import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchGlobalSettings } from "@/lib/api";
import { useProjectOrder } from "../stores/project-order-store";

// Module-level so every consumer (sidebar, dashboard, …) shares one guard and a
// server refetch doesn't clobber optimistic local reorders with an unchanged value.
let lastServerOrderJson: string | null = null;

/**
 * Hydrates the shared project-order store from the server-backed settings row.
 *
 * Call this from any view that renders the project list (sidebar, dashboard) —
 * hydration must not depend on the sidebar being mounted, since on mobile it
 * only mounts when opened. The react-query cache dedupes the underlying fetch.
 */
export function useProjectOrderHydration(): void {
  const { hydrateFromServer } = useProjectOrder();

  const { data: globalSettings } = useQuery({
    queryKey: ["global-settings"],
    queryFn: fetchGlobalSettings,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!globalSettings) return;
    const nextOrder = globalSettings.projectOrder ?? [];
    const nextOrderJson = JSON.stringify(nextOrder);
    if (lastServerOrderJson === nextOrderJson) return;
    lastServerOrderJson = nextOrderJson;
    hydrateFromServer(nextOrder);
  }, [globalSettings, hydrateFromServer]);
}
