import { useCallback, useEffect, useRef } from "react";
import { Outlet, useLocation } from "@tanstack/react-router";
import { Toaster } from "sonner";
import { MiniSidebar } from "@/components/layout/mini-sidebar";
import { Sidebar } from "@/components/layout/sidebar";
import { NoProvidersLanding } from "@/components/no-providers-landing";
import { useAvailableProviders } from "@/components/chat/input-area/use-available-providers";
import { useTheme } from "@/hooks/use-theme-store";
import { useLayoutStore } from "@/hooks/use-layout-store";
import { useMediaQuery } from "@/hooks/use-media-query";

export function AppLayout() {
  const { providers, isLoading: providersLoading } = useAvailableProviders();
  const location = useLocation();
  const isMobile = useMediaQuery("(max-width: 768px)");
  const { theme } = useTheme();
  const {
    sidebarCollapsed: collapsed,
    sidebarWidth,
    isResizing,
    mobileSidebarOpen,
    toggleSidebar: toggleCollapsed,
    setSidebarWidth,
    setIsResizing,
    setMobileSidebarOpen,
    persistWidth,
  } = useLayoutStore();

  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const onResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDragging.current = true;
      setIsResizing(true);
      startX.current = e.clientX;
      startWidth.current = sidebarWidth;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [sidebarWidth, setIsResizing],
  );

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = e.clientX - startX.current;
      setSidebarWidth(startWidth.current + delta);
    };
    const onMouseUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      setIsResizing(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      persistWidth();
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [setSidebarWidth, setIsResizing, persistWidth]);

  // Auto-close mobile sidebar overlay on navigation
  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [location.pathname, setMobileSidebarOpen]);

  // Close mobile sidebar overlay on Escape
  useEffect(() => {
    if (!isMobile || !mobileSidebarOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileSidebarOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isMobile, mobileSidebarOpen, setMobileSidebarOpen]);

  const toaster = (
    <Toaster
      position="bottom-right"
      theme={theme}
      toastOptions={{
        style: {
          fontFamily: "var(--font-sans)",
          background: "var(--color-glass)",
          border: "1px solid var(--color-glass-border)",
          color: "var(--color-text)",
          backdropFilter: "blur(20px) saturate(1.4)",
          WebkitBackdropFilter: "blur(20px) saturate(1.4)",
        },
      }}
    />
  );

  if (!providersLoading && providers.length === 0) {
    return <NoProvidersLanding />;
  }

  if (isMobile) {
    return (
      <div className="flex h-full overflow-hidden">
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-bg">
          <Outlet />
        </main>
        {/* Mobile sidebar overlay */}
        {mobileSidebarOpen && (
          <div className="fixed inset-0 z-50 flex">
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-black/50 animate-fade-in"
              onClick={() => setMobileSidebarOpen(false)}
            />
            {/* Sidebar panel */}
            <div className="relative z-10 h-full w-[85vw] max-w-sm animate-slide-in-left">
              <Sidebar />
            </div>
          </div>
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
          className={`shrink-0 overflow-hidden ${isResizing ? "" : "transition-[width] duration-200 ease-in-out"}`}
          style={{ width: collapsed ? 48 : sidebarWidth }}
        >
          {collapsed ? (
            <MiniSidebar onExpand={toggleCollapsed} />
          ) : (
            <Sidebar onCollapse={toggleCollapsed} />
          )}
        </div>
        {/* Resize handle – only when expanded */}
        {!collapsed && (
          <div
            className="relative z-10 flex w-0 cursor-col-resize items-stretch"
            onMouseDown={onResizeStart}
          >
            <div className="absolute inset-y-0 -left-px w-px bg-transparent transition-colors hover:bg-border active:bg-border" />
          </div>
        )}
        <main className="flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-bg">
          <Outlet />
        </main>
      </div>
      {toaster}
    </>
  );
}
