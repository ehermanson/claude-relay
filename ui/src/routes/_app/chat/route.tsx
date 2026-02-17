import { createFileRoute, Outlet, useParams } from "@tanstack/react-router";
import { useTerminalPendingToasts } from "../../../hooks/use-terminal-pending-toasts";

function ChatLayout() {
  const { id } = useParams({ strict: false }) as { id?: string };
  useTerminalPendingToasts(id);
  return <Outlet />;
}

export const Route = createFileRoute("/_app/chat")({
  component: ChatLayout,
});
