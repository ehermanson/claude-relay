import { createFileRoute } from "@tanstack/react-router";
import { ChatSandbox } from "@/components/debug/chat-sandbox";

export const Route = createFileRoute("/_app/sandbox")({
  component: ChatSandbox,
});
