import type { InstanceInfo } from "@shared/types";

export type RemoveProjectTarget = {
  id?: string;
  name: string;
  directory: string;
};

type StandaloneChatRoute = {
  to: "/projects/$projectId/chats/$chatId";
  params: {
    projectId: string;
    chatId: string;
  };
};

type SpaceChatRoute = {
  to: "/projects/$projectId/spaces/$spaceId/$chatId";
  params: {
    projectId: string;
    spaceId: string;
    chatId: string;
  };
};

type BareSpaceRoute = {
  to: "/projects/$projectId/spaces/$spaceId";
  params: {
    projectId: string;
    spaceId: string;
  };
};

type InstanceChatRoute = StandaloneChatRoute | SpaceChatRoute;
type SpaceRoute = BareSpaceRoute | SpaceChatRoute;

export function getProjectName(directory: string): string {
  return directory.split("/").pop() || directory;
}

export function getInstanceProjectRouteId(
  instance: Pick<InstanceInfo, "projectId" | "workingDirectory" | "originalDirectory">,
): string {
  return (
    instance.projectId ?? getProjectName(instance.originalDirectory ?? instance.workingDirectory)
  );
}

export function getInstanceChatRoute(
  instance: Pick<
    InstanceInfo,
    "id" | "projectId" | "workingDirectory" | "originalDirectory" | "spaceId"
  >,
): InstanceChatRoute {
  const projectId = getInstanceProjectRouteId(instance);
  if (instance.spaceId) {
    return {
      to: "/projects/$projectId/spaces/$spaceId/$chatId",
      params: {
        projectId,
        spaceId: instance.spaceId,
        chatId: instance.id,
      },
    };
  }

  return {
    to: "/projects/$projectId/chats/$chatId",
    params: {
      projectId,
      chatId: instance.id,
    },
  };
}

export function getSpaceRoute(
  projectId: string,
  spaceId: string,
  chatId?: string | null,
): SpaceRoute {
  if (chatId) {
    return {
      to: "/projects/$projectId/spaces/$spaceId/$chatId",
      params: {
        projectId,
        spaceId,
        chatId,
      },
    };
  }

  return {
    to: "/projects/$projectId/spaces/$spaceId",
    params: {
      projectId,
      spaceId,
    },
  };
}

export function instanceMatchesProject(
  instance: Pick<InstanceInfo, "projectId" | "workingDirectory" | "originalDirectory">,
  projectId: string,
): boolean {
  return getInstanceProjectRouteId(instance) === projectId;
}
