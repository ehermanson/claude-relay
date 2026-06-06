import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useProviderRuntimeStore } from "@/stores/provider-runtime-store";
import { formatTimeUntil } from "@/lib/utils";
import type { ProviderKind } from "@shared/types";

type RateLimitStatus = "allowed" | "allowed_warning" | "rejected";

/**
 * Fires a toast when a provider rate limit window transitions into
 * "allowed_warning" or "rejected". Re-fires if the status later resets and
 * re-enters the warning/rejected state.
 */
export function useRateLimitWarning(provider: ProviderKind | undefined, onOpenContext: () => void) {
  const providerGlobalState = useProviderRuntimeStore((s) => s.providerGlobalState);
  // Map of "<scope>/<windowIndex>" → last-seen status, so we only toast on transitions.
  const prevStatusRef = useRef(new Map<string, RateLimitStatus>());
  // Keep the latest callback without making it an effect dependency.
  const onOpenContextRef = useRef(onOpenContext);
  onOpenContextRef.current = onOpenContext;

  useEffect(() => {
    if (!provider) return;
    const rateLimits = providerGlobalState[provider]?.account?.rateLimits ?? [];

    for (const limit of rateLimits) {
      const windows = limit.windows ?? [];
      for (let i = 0; i < windows.length; i++) {
        const window = windows[i];
        const key = `${limit.scope ?? limit.name ?? "unknown"}/${i}`;
        const currentStatus = (window.status ?? "allowed") as RateLimitStatus;
        const prevStatus = prevStatusRef.current.get(key) ?? "allowed";
        if (currentStatus === prevStatus) continue;

        prevStatusRef.current.set(key, currentStatus);
        if (currentStatus === "allowed") continue; // recovered — nothing to surface

        const resetIn = window.resetAt ? formatTimeUntil(window.resetAt) : "";
        const resetDesc = resetIn ? ` · resets in ${resetIn}` : "";
        const limitName = formatWindowName(limit.scope ?? limit.name);
        const action = { label: "View context", onClick: () => onOpenContextRef.current() };

        if (currentStatus === "allowed_warning") {
          toast.warning(`Rate limit warning${resetDesc}`, {
            description: `Approaching the ${limitName} limit`,
            action,
            duration: 8000,
          });
        } else {
          toast.error(`Rate limit reached${resetDesc}`, {
            description: `The ${limitName} limit has been hit`,
            action,
            duration: 12000,
          });
        }
      }
    }
  }, [provider, providerGlobalState]);
}

function formatWindowName(scope: string | undefined): string {
  if (!scope) return "usage";
  return scope.replace(/_/g, " ");
}
