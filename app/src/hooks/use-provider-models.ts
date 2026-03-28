import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ProviderCapabilities, ProviderKind, ProviderModelOption } from "@shared/types";
import { getDefaultProviderCapabilities } from "@shared/provider-catalog";
import { fetchProviderModels } from "@/lib/api";

export function useProviderModels(provider: ProviderKind) {
  const [showModelMenu, setShowModelMenu] = useState(false);

  const { data } = useQuery({
    queryKey: ["providerModels", provider],
    queryFn: () => fetchProviderModels(provider),
  });

  const availableProviderModels: ProviderModelOption[] =
    data?.models.filter((model) => !model.hidden) ?? [];
  const capabilities: ProviderCapabilities =
    data?.capabilities ?? getDefaultProviderCapabilities(provider);

  return {
    showModelMenu,
    setShowModelMenu,
    availableProviderModels,
    capabilities,
  };
}
