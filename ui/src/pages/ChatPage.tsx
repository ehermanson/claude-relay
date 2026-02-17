import { useParams } from "@tanstack/react-router";
import { Group, Panel } from "react-resizable-panels";
import { Toaster } from "sonner";
import { Sidebar } from "../components/layout/Sidebar";
import { InstanceView } from "../components/chat/InstanceView";
import { ResizableHandle } from "../components/ui/ResizableHandle";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { useTerminalPendingToasts } from "../hooks/useTerminalPendingToasts";
import { useTheme } from "../context/ThemeContext";

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center p-10 text-center">
      <div className="mb-3 text-3xl opacity-20">
        <svg
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-muted"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </div>
      <p className="mb-1 text-sm font-medium text-text">Select an instance to start chatting</p>
      <span className="text-xs text-muted">Or create a new one from the sidebar</span>
    </div>
  );
}

export function ChatPage() {
  const { id } = useParams({ strict: false }) as { id?: string };
  const isMobile = useMediaQuery("(max-width: 768px)");
  const { theme } = useTheme();

  useTerminalPendingToasts(id);

  const hasInstance = !!id;
  const showSidebar = !isMobile || !hasInstance;
  const showMain = !isMobile || hasInstance;

  if (isMobile) {
    return (
      <div className="flex h-full overflow-hidden">
        {showSidebar && <Sidebar />}
        {showMain && (
          <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-bg">
            {id ? <InstanceView /> : <EmptyState />}
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
            {id ? <InstanceView /> : <EmptyState />}
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
