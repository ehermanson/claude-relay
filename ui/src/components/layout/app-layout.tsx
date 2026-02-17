import { Outlet, useParams } from "@tanstack/react-router";
import { Group, Panel } from "react-resizable-panels";
import { Toaster } from "sonner";
import { Sidebar } from "./sidebar";
import { ResizableHandle } from "../ui/resizable-handle";
import { useMediaQuery } from "../../hooks/use-media-query";
import { useTheme } from "../../context/theme-context";

export function AppLayout() {
  const { id, projectId } = useParams({ strict: false }) as { id?: string; projectId?: string };
  const isMobile = useMediaQuery("(max-width: 768px)");
  const { theme } = useTheme();

  // On mobile: show sidebar only when on /chat with no instance selected
  const hasContent = !!id || !!projectId;
  const showSidebar = !isMobile || !hasContent;
  const showMain = !isMobile || hasContent;

  if (isMobile) {
    return (
      <div className="flex h-full overflow-hidden">
        {showSidebar && <Sidebar />}
        {showMain && (
          <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-bg">
            <Outlet />
          </main>
        )}
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
      </div>
    );
  }

  return (
    <>
      <Group orientation="horizontal" className="h-full">
        <Panel defaultSize="25" minSize="12" maxSize="40" collapsible collapsedSize="0">
          <Sidebar />
        </Panel>
        <ResizableHandle />
        <Panel defaultSize="75" minSize="40">
          <main className="flex h-full min-w-0 flex-col overflow-hidden bg-bg">
            <Outlet />
          </main>
        </Panel>
      </Group>
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
    </>
  );
}
