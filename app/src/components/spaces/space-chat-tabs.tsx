import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { SpaceChatTab } from "@/components/spaces/space-chat-tab";
import type { InstanceInfo } from "@shared/types";

export function SpaceChatTabs({
  instances,
  activeTab,
  onNavigateToChat,
  onRenameTab,
  onCloseTab,
  onNewChat,
}: {
  instances: InstanceInfo[];
  activeTab: string | null;
  onNavigateToChat: (id: string) => void;
  onRenameTab: (instanceId: string, name: string) => void;
  onCloseTab: (id: string) => void;
  onNewChat: () => void;
}) {
  const tabsScrollRef = useRef<HTMLDivElement>(null);
  const [tabsOverflow, setTabsOverflow] = useState({ left: false, right: false });

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

  return (
    <div className="relative flex shrink-0 items-center border-b border-border bg-surface">
      <div
        className={`pointer-events-none absolute left-0 top-0 bottom-0 z-10 flex w-8 items-center justify-center bg-gradient-to-r from-surface via-surface/60 to-transparent transition-opacity duration-150 ${tabsOverflow.left ? "opacity-100" : "opacity-0"}`}
      >
        <ChevronLeft size={11} strokeWidth={2.5} className="text-muted" />
      </div>
      <div ref={tabsScrollRef} className="scrollbar-none flex items-center overflow-x-auto pl-1">
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
        <button
          onClick={onNewChat}
          className="flex h-full shrink-0 items-center px-2.5 py-2 text-muted transition-colors hover:bg-surface-hover hover:text-accent"
        >
          <Plus size={13} strokeWidth={2.5} />
        </button>
      </div>
      <div
        className={`pointer-events-none absolute right-0 top-0 bottom-0 z-10 flex w-8 items-center justify-center bg-gradient-to-l from-surface via-surface/60 to-transparent transition-opacity duration-150 ${tabsOverflow.right ? "opacity-100" : "opacity-0"}`}
      >
        <ChevronRight size={11} strokeWidth={2.5} className="text-muted" />
      </div>
    </div>
  );
}
