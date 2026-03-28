import { useQuery } from "@tanstack/react-query";
import type { ProviderDescriptor } from "@shared/types";
import { fetchProviders } from "@/lib/api";

export function useAvailableProviders() {
  const { data: providers = [], isLoading } = useQuery<ProviderDescriptor[]>({
    queryKey: ["providers"],
    queryFn: fetchProviders,
  });

  return { providers, isLoading };
}
