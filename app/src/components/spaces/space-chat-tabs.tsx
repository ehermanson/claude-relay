import { useCallback, useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { SpaceChatTab } from "@/components/spaces/space-chat-tab";
import { Spinner } from "@/components/ui/spinner";
import type { InstanceInfo } from "@shared/types";

export function SpaceChatTabs({
  instances,
  activeTab,
  pendingNewChatId,
  pendingNewChat,
  onNavigateToChat,
  onRenameTab,
  onCloseTab,
  onNewChat,
  disableNewChat = false,
}: {
  instances: InstanceInfo[];
  activeTab: string | null;
  pendingNewChatId: string | null;
  pendingNewChat?: boolean;
  onNavigateToChat: (id: string) => void;
  onRenameTab: (instanceId: string, name: string) => void;
  onCloseTab: (id: string) => void;
  onNewChat: () => void;
  disableNewChat?: boolean;
}) {
  const tabsScrollRef = useRef<HTMLDivElement>(null);
  const [tabsOverflow, setTabsOverflow] = useState({ left: false, right: false });
  const shouldShowPendingTab =
    !!pendingNewChat &&
    !!pendingNewChatId &&
    !instances.some((inst) => inst.id === pendingNewChatId);

  const updateTabsOverflow = useCallback(() => {
    const el = tabsScrollRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setTabsOverflow({
      left: scrollLeft > 2,
      right: scrollLeft + clientWidth < scrollWidth - 2,
    });
  }, []);

  useEffect(() => {
    const el = tabsScrollRef.current;
    if (!el) return;
    updateTabsOverflow();
    el.addEventListener("scroll", updateTabsOverflow, { passive: true });

    const ro = new ResizeObserver(updateTabsOverflow);
    ro.observe(el);
    for (const child of el.children) ro.observe(child);

    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return;
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      el.removeEventListener("scroll", updateTabsOverflow);
      el.removeEventListener("wheel", onWheel);
      ro.disconnect();
    };
  }, [updateTabsOverflow, instances.length]);

  useEffect(() => {
    const el = tabsScrollRef.current;
    if (!el || !activeTab) return;
    const activeEl = el.querySelector<HTMLElement>(`[data-chat-tab-id="${activeTab}"]`);
    activeEl?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeTab, shouldShowPendingTab, instances.length]);

  return (
    <div className="relative flex shrink-0 items-center border-b border-border/70">
      <div
        className={`pointer-events-none absolute left-0 top-0 bottom-0 z-10 flex w-8 items-center justify-center bg-gradient-to-r from-surface via-surface/60 to-transparent transition-opacity duration-150 ${tabsOverflow.left ? "opacity-100" : "opacity-0"}`}
      />
      <div ref={tabsScrollRef} className="scrollbar-none flex min-w-0 items-center overflow-x-auto">
        {instances.map((inst) => (
          <SpaceChatTab
            key={inst.id}
            instance={inst}
            isActive={activeTab === inst.id}
            onClick={() => onNavigateToChat(inst.id)}
            onRename={(name) => onRenameTab(inst.id, name)}
            onDelete={() => onCloseTab(inst.id)}
          />
        ))}
        {shouldShowPendingTab && (
          <div
            data-chat-tab-id={pendingNewChatId}
            className="flex shrink-0 items-center gap-1 px-2.5 py-1.5 text-[0.75rem] shadow-[inset_0_-2px_0_0_var(--color-accent)]"
          >
            <Spinner size={9} />
            <span className="font-medium text-muted">Creating chat...</span>
          </div>
        )}
      </div>
      <button
        onClick={onNewChat}
        disabled={disableNewChat || pendingNewChat}
        title={
          disableNewChat ? "This space is read-only until its worktree is repaired" : undefined
        }
        className="flex h-full shrink-0 items-center px-2.5 py-1.5 text-muted transition-colors hover:bg-surface-hover hover:text-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted"
      >
        <Plus size={13} strokeWidth={2.5} />
      </button>
      <div
        className={`pointer-events-none absolute right-[33px] top-0 bottom-0 z-10 flex w-8 items-center justify-center bg-gradient-to-l from-surface via-surface/60 to-transparent transition-opacity duration-150 ${tabsOverflow.right ? "opacity-100" : "opacity-0"}`}
      />
    </div>
  );
}
