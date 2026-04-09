import { createContext, useContext } from "react";
import type { MouseEvent, ReactNode, RefObject } from "react";
import type { ChatItem, LiveActivity } from "@/hooks/use-instance-messages";
import type { SidecarTab } from "@/stores/sidecar-store";
import type {
  FileChange,
  HistoryEntry,
  InstanceInfo,
  ProviderKind,
  ProviderRequest,
  TaskItem,
  TerminalScope,
  UserInputAnswer,
} from "@shared/types";

type ConnectionBannerState = {
  kind: "reconnecting" | "resyncing" | "running" | "interrupted";
  onDismiss?: () => void;
  onContinue?: () => void;
} | null;

export type InstanceViewContextValue = {
  shared: {
    id: string;
    compact: boolean;
    instance: InstanceInfo;
    planChild?: InstanceInfo;
    items: ChatItem[];
    rawHistory: HistoryEntry[] | null;
    currentTasks: TaskItem[] | null;
    currentFiles: FileChange[] | null;
    lastActivity: LiveActivity | null;
    processingStartedAt: number | null;
    isConnected: boolean;
    isSyncing: boolean;
    isActive: boolean;
    hasLoadedHistory: boolean;
    showThinkingIndicator: boolean;
    isMobile: boolean;
    isStopped: boolean;
    hasStats: boolean;
    hasTasksContent: boolean;
    hasFilesContent: boolean;
    tasksCount: number;
    filesCount: number;
    hasPlanContent: boolean;
    showDesktopSidecar: boolean;
    activePanels: ReadonlySet<SidecarTab>;
    allContentPanels: ReadonlySet<SidecarTab>;
    sidecarMobileOpen: boolean;
    sidecarContentCount: number;
    sidecarWidth: number | null;
    isResizing: boolean;
    showTerminalPanel: boolean;
    isTerminalCollapsed: boolean;
    collapsedTerminalCount: number;
    terminalScope: TerminalScope;
    terminalHeight: number;
    terminalContexts: Array<{ id: string; terminalName: string; text: string }>;
    pendingUserInput: ProviderRequest | null;
    pendingTerminalInput: ProviderRequest | null;
    isPendingApproval: boolean;
    pendingApprovalRequest: ProviderRequest | null;
    pendingPermissionTool: string | null;
    pendingPermissionRequestId: string | null;
    pendingPermissionDesc?: string;
    pendingTerminalTool: string | null;
    approvedTools: Set<string>;
    showDebugPaste: boolean;
    confirmDelete: boolean;
    isLoadingSession: boolean;
    showBranchChangeBanner: boolean;
    branchChangeKey: string | null;
    connectionBanner: ConnectionBannerState;
    containerRef: RefObject<HTMLDivElement | null>;
    sidecarRef: RefObject<HTMLDivElement | null>;
  };
  actions: {
    navigateToSplitPicker: () => void;
    navigateAfterDelete: () => void;
    sendRemoveInstance: () => void;
    handleSend: (text: string, images?: string[], internal?: boolean) => void;
    handleAnswerUserInput: (requestId: string, answers: Record<string, UserInputAnswer>) => void;
    handleTakeover: () => void;
    handleCancel: () => void;
    handleInterruptAndSend: () => void;
    handleSwitchProvider: (
      targetProvider: ProviderKind,
      carryContext: boolean,
      model?: string | null,
    ) => Promise<void>;
    setShowDebugPaste: (open: boolean) => void;
    setConfirmDelete: (open: boolean) => void;
    handleRespondToRequest: (
      requestId: string,
      tool: string,
      decision?: "accept" | "decline",
      text?: string,
    ) => void;
    handleApproveTool: (tool: string) => void;
    dismissBranchChangeBanner: () => void;
    togglePanel: (panel: SidecarTab) => void;
    setSidecarMobileOpen: (open: boolean) => void;
    handleToggleTerminal: () => void;
    expandTerminalPanel: () => void;
    handleTerminalResizeStart: (e: MouseEvent) => void;
    handleResizeStart: (e: MouseEvent) => void;
    removeTerminalContext: (attachmentId: string) => void;
  };
};

const InstanceViewContext = createContext<InstanceViewContextValue | null>(null);

export function InstanceViewProvider({
  value,
  children,
}: {
  value: InstanceViewContextValue;
  children: ReactNode;
}) {
  return <InstanceViewContext.Provider value={value}>{children}</InstanceViewContext.Provider>;
}

export function useInstanceViewContext() {
  const value = useContext(InstanceViewContext);
  if (!value) {
    throw new Error("useInstanceViewContext must be used within InstanceViewProvider");
  }
  return value;
}
