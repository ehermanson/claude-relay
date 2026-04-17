import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ProviderCapabilities, ProviderKind, ProviderModelOption } from "@shared/types";
import { getDefaultProviderCapabilities } from "@shared/provider-catalog";
import { fetchProviderModels } from "@/lib/api";

export function useProviderModels(provider?: ProviderKind) {
  const [showModelMenu, setShowModelMenu] = useState(false);

  const { data } = useQuery({
    // queryFn only runs when `enabled` is true, so the non-null assertion is safe.
    queryKey: ["providerModels", provider],
    queryFn: () => fetchProviderModels(provider!),
    enabled: !!provider,
  });

  const availableProviderModels: ProviderModelOption[] =
    data?.models.filter((model) => !model.hidden) ?? [];
  const capabilities: ProviderCapabilities =
    data?.capabilities ?? getDefaultProviderCapabilities(provider ?? "claude");
  const defaultModel = data?.defaultModel;

  return {
    showModelMenu,
    setShowModelMenu,
    availableProviderModels,
    capabilities,
    defaultModel,
  };
}
