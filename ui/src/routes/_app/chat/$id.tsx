import { createFileRoute } from "@tanstack/react-router";
import { InstanceView } from "../../../components/chat/instance-view";

export const Route = createFileRoute("/_app/chat/$id")({
  component: InstanceView,
});
