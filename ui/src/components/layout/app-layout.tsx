import { useCallback, useEffect, useRef, useState } from "react";
import { Outlet, useParams } from "@tanstack/react-router";
import { Toaster } from "sonner";
import { MiniSidebar } from "@/components/layout/mini-sidebar";
import { Sidebar } from "@/components/layout/sidebar";
import { useTheme } from "@/context/theme-context";
import { useMediaQuery } from "@/hooks/use-media-query";

const STORAGE_KEY = "relay-sidebar-collapsed";
const WIDTH_STORAGE_KEY = "relay-sidebar-width";
const DEFAULT_WIDTH = 300;
const MIN_WIDTH = 200;
const MAX_WIDTH = 500;

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function readWidth(): number {
  try {
    const v = Number(localStorage.getItem(WIDTH_STORAGE_KEY));
    if (v >= MIN_WIDTH && v <= MAX_WIDTH) return v;
  } catch {}
  return DEFAULT_WIDTH;
}

export function AppLayout() {
  const { chatId, projectId } = useParams({ strict: false }) as {
    chatId?: string;
    projectId?: string;
  };
  const isMobile = useMediaQuery("(max-width: 768px)");
  const { theme } = useTheme();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [sidebarWidth, setSidebarWidth] = useState(readWidth);
  const [isResizing, setIsResizing] = useState(false);
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {}
      return next;
    });
  };

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
    [sidebarWidth],
  );

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = e.clientX - startX.current;
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth.current + delta));
      setSidebarWidth(next);
    };
    const onMouseUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      setIsResizing(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      // persist on release
      try {
        localStorage.setItem(WIDTH_STORAGE_KEY, String(sidebarWidth));
      } catch {}
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [sidebarWidth]);

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
