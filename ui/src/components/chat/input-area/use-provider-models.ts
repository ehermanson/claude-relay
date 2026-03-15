import { useEffect, useState } from "react";
import type { ProviderCapabilities, ProviderKind, ProviderModelOption } from "@shared/types";
import { getDefaultProviderCapabilities } from "@shared/provider-catalog";
import { fetchProviderModels } from "../../../lib/api";

export function useProviderModels(provider: ProviderKind) {
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [availableProviderModels, setAvailableProviderModels] = useState<ProviderModelOption[]>([]);
  const [capabilities, setCapabilities] = useState<ProviderCapabilities>(
    getDefaultProviderCapabilities(provider),
  );

  useEffect(() => {
    setCapabilities(getDefaultProviderCapabilities(provider));
  }, [provider]);

  useEffect(() => {
    let cancelled = false;

    fetchProviderModels(provider)
      .then(({ models, capabilities }) => {
        if (!cancelled) {
          setAvailableProviderModels(models.filter((model) => !model.hidden));
          setCapabilities(capabilities);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAvailableProviderModels([]);
          setCapabilities(getDefaultProviderCapabilities(provider));
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
    capabilities,
  };
}
