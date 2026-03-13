import { useEffect, useState } from "react";
import type { ProviderKind, ProviderModelOption } from "@shared/types";
import { fetchProviderModels } from "../../../lib/api";

export function useProviderModels(provider: ProviderKind) {
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [availableProviderModels, setAvailableProviderModels] = useState<ProviderModelOption[]>([]);

  useEffect(() => {
    let cancelled = false;

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
  }, [provider]);

  return {
    showModelMenu,
    setShowModelMenu,
    availableProviderModels,
  };
}
