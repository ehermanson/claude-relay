import { useState } from "react";
import type { ProviderKind } from "@shared/types";

export function useProviderSwitchState(
  currentProvider: ProviderKind,
  onSwitchProvider?: (
    provider: ProviderKind,
    carryContext: boolean,
    model?: string | null,
  ) => Promise<void> | void,
) {
  const [showProviderSwitchDialog, setShowProviderSwitchDialog] = useState(false);
  const [providerSwitchTarget, setProviderSwitchTarget] = useState<ProviderKind | null>(null);
  const [providerSwitchModel, setProviderSwitchModel] = useState<string | null>(null);
  const [carryProviderContext, setCarryProviderContext] = useState(true);
  const [providerSwitchError, setProviderSwitchError] = useState("");
  const [isSwitchingProvider, setIsSwitchingProvider] = useState(false);

  const openProviderSwitchDialog = (targetProvider: ProviderKind, model?: string | null) => {
    if (!onSwitchProvider || targetProvider === currentProvider) return;
    setProviderSwitchTarget(targetProvider);
    setProviderSwitchModel(model ?? null);
    setCarryProviderContext(true);
    setProviderSwitchError("");
    setShowProviderSwitchDialog(true);
  };

  const closeProviderSwitchDialog = () => {
    setShowProviderSwitchDialog(false);
    setProviderSwitchTarget(null);
    setProviderSwitchModel(null);
    setProviderSwitchError("");
    setCarryProviderContext(true);
  };

  const handleProviderSwitch = async () => {
    if (!providerSwitchTarget || !onSwitchProvider) return;
    setIsSwitchingProvider(true);
    setProviderSwitchError("");

    try {
      await onSwitchProvider(providerSwitchTarget, carryProviderContext, providerSwitchModel);
      closeProviderSwitchDialog();
    } catch (error) {
      setProviderSwitchError(
        error instanceof Error ? error.message : "Failed to start the new provider chat",
      );
    } finally {
      setIsSwitchingProvider(false);
    }
  };

  return {
    showProviderSwitchDialog,
    providerSwitchTarget,
    providerSwitchModel,
    carryProviderContext,
    providerSwitchError,
    isSwitchingProvider,
    openProviderSwitchDialog,
    closeProviderSwitchDialog,
    setCarryProviderContext,
    handleProviderSwitch,
  };
}
