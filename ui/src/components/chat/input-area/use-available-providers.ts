import { useEffect, useState } from "react";
import type { ProviderDescriptor } from "@shared/types";
import { fetchProviders } from "../../../lib/api";

export function useAvailableProviders() {
  const [providers, setProviders] = useState<ProviderDescriptor[]>([]);

  useEffect(() => {
    let cancelled = false;

    fetchProviders()
      .then((nextProviders) => {
        if (!cancelled) {
          setProviders(nextProviders);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setProviders([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { providers };
}
