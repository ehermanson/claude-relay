import { create } from "zustand";
import type { ProviderGlobalState, ProviderKind } from "@shared/types";

type ProviderRuntimeStateMap = Partial<Record<ProviderKind, ProviderGlobalState>>;

interface ProviderRuntimeStore {
  providerGlobalState: ProviderRuntimeStateMap;
  setProviderGlobalStateList: (states: ProviderGlobalState[]) => void;
  updateProviderGlobalState: (provider: ProviderKind, state: ProviderGlobalState) => void;
}

export const useProviderRuntimeStore = create<ProviderRuntimeStore>()((set) => ({
  providerGlobalState: {},

  setProviderGlobalStateList: (states) =>
    set({
      providerGlobalState: Object.fromEntries(states.map((state) => [state.provider, state])),
    }),

  updateProviderGlobalState: (provider, state) =>
    set((current) => ({
      providerGlobalState: {
        ...current.providerGlobalState,
        [provider]: state,
      },
    })),
}));
