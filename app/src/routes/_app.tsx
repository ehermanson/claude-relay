import { createFileRoute, useParams } from "@tanstack/react-router";
import { WebSocketProvider } from "../context/websocket-context";
import { AppLayout } from "../components/layout/app-layout";
import { ActionToastProvider } from "@/context/action-toast-context";
import { useTerminalPendingToasts } from "../hooks/use-terminal-pending-toasts";

function AppLayoutWithToasts() {
  const { chatId } = useParams({ strict: false }) as { chatId?: string };
  useTerminalPendingToasts(chatId);
  return <AppLayout />;
}

export const Route = createFileRoute("/_app")({
  component: () => (
    <WebSocketProvider>
      <ActionToastProvider>
        <AppLayoutWithToasts />
      </ActionToastProvider>
    </WebSocketProvider>
  ),
});
