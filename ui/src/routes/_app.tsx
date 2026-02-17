import { createFileRoute } from "@tanstack/react-router";
import { WebSocketProvider } from "../context/websocket-context";
import { AppLayout } from "../components/layout/app-layout";

export const Route = createFileRoute("/_app")({
  component: () => (
    <WebSocketProvider>
      <AppLayout />
    </WebSocketProvider>
  ),
});
