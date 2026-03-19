import { useState } from "react";
import { Outlet, useParams } from "@tanstack/react-router";
import { Toaster } from "sonner";
import { MiniSidebar } from "@/components/layout/mini-sidebar";
import { Sidebar } from "@/components/layout/sidebar";
import { useTheme } from "@/context/theme-context";
import { useMediaQuery } from "@/hooks/use-media-query";

const STORAGE_KEY = "relay-sidebar-collapsed";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function AppLayout() {
  const { chatId, projectId } = useParams({ strict: false }) as {
    chatId?: string;
    projectId?: string;
  };
  const isMobile = useMediaQuery("(max-width: 768px)");
  const { theme } = useTheme();
  const [collapsed, setCollapsed] = useState(readCollapsed);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {}
      return next;
    });
  };

  // On mobile: show sidebar only when on / with no instance selected
  const hasContent = !!chatId || !!projectId;
  const showSidebar = !isMobile || !hasContent;
  const showMain = !isMobile || hasContent;

  const toaster = (
    <Toaster
      position="bottom-right"
      theme={theme}
      toastOptions={{
        style: {
          background: "var(--color-surface-raised)",
          border: "1px solid var(--color-border)",
          color: "var(--color-text)",
        },
      }}
    />
  );

  if (isMobile) {
    return (
      <div className="flex h-full overflow-hidden">
        {showSidebar && <Sidebar />}
        {showMain && (
          <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-bg">
            <Outlet />
          </main>
        )}
        {toaster}
      </div>
    );
  }

  return (
    <>
      <div className="flex h-full overflow-hidden">
        {/* Animated sidebar container */}
        <div
          className="shrink-0 overflow-hidden transition-[width] duration-200 ease-in-out"
          style={{ width: collapsed ? 48 : 300 }}
        >
          {collapsed ? (
            <MiniSidebar onExpand={toggleCollapsed} />
          ) : (
            <Sidebar onCollapse={toggleCollapsed} />
          )}
        </div>
        <main className="flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-bg">
          <Outlet />
        </main>
      </div>
      {toaster}
    </>
  );
}
