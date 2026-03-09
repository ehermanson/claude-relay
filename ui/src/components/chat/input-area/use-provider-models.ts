import { useEffect, useState } from "react";
import type { ProviderKind, ProviderModelOption } from "@shared/types";
import { fetchProviderModels } from "../../../lib/api";

export function useProviderModels(provider: ProviderKind, isExternal?: boolean) {
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [availableProviderModels, setAvailableProviderModels] = useState<ProviderModelOption[]>([]);

  useEffect(() => {
    let cancelled = false;

    if (isExternal) {
      setAvailableProviderModels([]);
      return;
    }

    fetchProviderModels(provider)
      .then((models) => {
        if (!cancelled) {
          setAvailableProviderModels(models.filter((model) => !model.hidden));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAvailableProviderModels([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isExternal, provider]);

  return {
    showModelMenu,
    setShowModelMenu,
    availableProviderModels,
  };
}
