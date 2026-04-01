import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "@tanstack/react-router";
import { Archive, ChevronDown, ChevronRight, GitBranch, MessageSquare, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { EmptyProjectActions } from "@/components/empty-project-actions";
import { EmptyState } from "@/components/empty-state";
import { CreateSpaceDialog, useCreateSpaceDialog } from "@/components/spaces/create-space-dialog";
import { Tooltip } from "@/components/ui/tooltip";
import { useProjectContext } from "@/context/project-context";
import { useWSMethods, useWSState } from "@/context/websocket-context";
import { useActionToasts } from "@/context/action-toast-context";
import { useMediaQuery } from "@/hooks/use-media-query";
import { fetchProjectChats, fetchAllSpaces } from "@/lib/api";
import { getInstanceChatRoute, instanceMatchesProject } from "@/lib/project-route";
import { getResolvedSpaceId, isSpaceOwnedInstance } from "@/lib/space-membership";
import {
  formatModel,
  formatTimeAgo,
  formatTokens,
  getDisplaySessionStats,
  instanceStatusVariant,
} from "@/lib/utils";
import { PageShell } from "@/components/ui/page-shell";
import { StatusDot } from "@/components/ui/status-dot";
import type { InstanceInfo, SpaceInfo } from "@shared/types";

function SessionCard({
  instance,
  parentName,
  isMobile,
}: {
  instance: InstanceInfo;
  parentName?: string;
  isMobile: boolean;
}) {
  const route = getInstanceChatRoute(instance);
  const displayStats = instance.stats
    ? getDisplaySessionStats(instance.provider, instance.stats)
    : null;

  return (
    <Link
      to={route.to}
      params={route.params}
      className="group flex items-center gap-3 rounded-lg border border-border/80 bg-surface px-4 py-3 transition-all duration-150 hover:-translate-y-px hover:border-accent/30 hover:bg-surface-hover hover:shadow-sm"
    >
      {/* Status dot */}
      <StatusDot
        variant={instanceStatusVariant(instance.status, !!instance.pendingTool)}
        size={6}
      />

      {/* Main column — name, preview, parent */}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[0.8125rem] font-medium text-text-bright">
          {instance.name}
        </div>
        {parentName && (
          <div className="mt-0.5 truncate text-[0.6875rem] text-muted">
            {"\u21B3"} from {parentName}
          </div>
        )}
        {instance.lastMessage && (
          <div className="mt-0.5 truncate text-[0.6875rem] text-muted">
            {instance.lastMessage.text}
          </div>
        )}

        {/* Mobile: inline model */}
        {isMobile && instance.stats?.model && (
          <div className="mt-1 flex items-center gap-2 text-[0.625rem] text-muted">
            <span>{formatModel(instance.stats.model)}</span>
          </div>
        )}
      </div>

      {/* Git branch badge */}
      {instance.gitBranch && (
        <Badge variant="default" className="hidden shrink-0 sm:flex">
          <GitBranch size={10} className="mr-1" />
          <span className="max-w-[120px] truncate">{instance.gitBranch}</span>
        </Badge>
      )}

      {/* Model + cost column (desktop) */}
      {!isMobile && instance.stats && (
        <div className="hidden shrink-0 text-right sm:block">
          {instance.stats.model && (
            <div className="text-[0.6875rem] text-muted">{formatModel(instance.stats.model)}</div>
          )}
          <Tooltip
            content={
              <div className="flex flex-col gap-0.5">
                <div>Total: {formatTokens(displayStats?.totalTokens ?? 0)}</div>
                <div>Input: {formatTokens(displayStats?.inputTokens ?? 0)}</div>
                <div>Output: {formatTokens(instance.stats.outputTokens)}</div>
                {instance.stats.cacheCreationTokens > 0 && (
                  <div>Cache write: {formatTokens(instance.stats.cacheCreationTokens)}</div>
                )}
                {instance.stats.cacheReadTokens > 0 && (
                  <div>Cache read: {formatTokens(instance.stats.cacheReadTokens)}</div>
                )}
              </div>
            }
          >
            <div className="text-[0.6875rem] text-muted">
              {formatTokens(displayStats?.totalTokens ?? 0)} tokens
            </div>
          </Tooltip>
        </div>
      )}

      {/* Timestamps column */}
      <div className="hidden shrink-0 text-right sm:block">
        {instance.lastActivityAt > 0 && (
          <div className="text-[0.6875rem] text-muted">
            {formatTimeAgo(instance.lastActivityAt)}
          </div>
        )}
        {instance.createdAt > 0 && (
          <div className="text-[0.625rem] text-muted opacity-60">
            {new Date(instance.createdAt).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })}
          </div>
        )}
      </div>
    </Link>
  );
}

function SpaceCard({
  projectId,
  space,
  chats,
  isMobile,
}: {
  projectId: string;
  space: SpaceInfo;
  chats: InstanceInfo[];
  isMobile: boolean;
}) {
  const lastActivity = Math.max(
    space.lastActivityAt || 0,
    ...chats.map((chat) => chat.lastActivityAt),
  );

  return (
    <div className="overflow-hidden rounded-lg border border-border/80 bg-surface">
      <Link
        to="/projects/$projectId/spaces/$spaceId"
        params={{ projectId, spaceId: space.id }}
        className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-hover"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent">
          <GitBranch size={14} strokeWidth={2.2} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 truncate text-[0.8125rem] font-semibold text-text-bright">
            {space.name}
            {space.status === "completed" && (
              <Badge variant="success" size="xs">
                Merged
              </Badge>
            )}
            {space.status === "archived" && (
              <Badge variant="default" size="xs">
                Archived
              </Badge>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[0.6875rem] text-muted">
            {space.gitBranch && <span className="truncate">{space.gitBranch}</span>}
            <span>
              {chats.length} chat{chats.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>

        {!isMobile && lastActivity > 0 && (
          <div className="shrink-0 text-right text-[0.6875rem] text-muted">
            {formatTimeAgo(lastActivity)}
          </div>
        )}
      </Link>

      <div className="border-t border-border/60 bg-background/25 px-3 py-2">
        {chats.length === 0 ? (
          <div className="rounded-md border border-dashed border-border/60 px-4 py-3 text-[0.75rem] text-muted">
            No chats yet in this space
          </div>
        ) : (
          chats.map((chat) => {
            const route = getInstanceChatRoute(chat);
            return (
              <Link
                key={chat.id}
                to={route.to}
                params={route.params}
                className="group ml-4 flex items-center gap-3 rounded-md border border-transparent px-3 py-2 transition-colors hover:border-border/60 hover:bg-surface-hover/70"
              >
                <StatusDot
                  variant={instanceStatusVariant(chat.status, !!chat.pendingTool)}
                  size={6}
                />

                <div className="min-w-0 flex-1">
                  <div className="truncate text-[0.75rem] font-medium text-text">{chat.name}</div>
                  {chat.lastMessage && (
                    <div className="mt-0.5 truncate text-[0.6875rem] text-muted">
                      {chat.lastMessage.text}
                    </div>
                  )}
                </div>

                {!isMobile && chat.lastActivityAt > 0 && (
                  <div className="shrink-0 text-[0.6875rem] text-muted">
                    {formatTimeAgo(chat.lastActivityAt)}
                  </div>
                )}
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}

export function ChatsPage() {
  const { projectId: routeProjectId } = useParams({ strict: false }) as { projectId: string };
  const isMobile = useMediaQuery("(max-width: 768px)");
  const queryClient = useQueryClient();
  const { addMessageHandler, send } = useWSMethods();
  const { instances } = useWSState();
  const { artifacts } = useProjectContext();
  const { trackInstanceCreate } = useActionToasts();
  const [searchQuery, setSearchQuery] = useState("");
  const spaceDialog = useCreateSpaceDialog();
  const projectId = artifacts.projectId || routeProjectId;
  const spacesQueryKey = ["spaces", projectId] as const;
  const chatsQueryKey = ["projectChats", projectId] as const;

  const { data: spaces = [] } = useQuery({
    queryKey: spacesQueryKey,
    queryFn: () => fetchAllSpaces(projectId),
    enabled: !!projectId,
  });
  const { data: chatSummaries = [] } = useQuery({
    queryKey: chatsQueryKey,
    queryFn: () => fetchProjectChats(projectId),
    enabled: !!projectId,
  });

  useEffect(() => {
    return addMessageHandler((message) => {
      if (message.type === "space_list" && message.projectDirectory === artifacts.directory) {
        queryClient.setQueryData(spacesQueryKey, message.spaces);
        return;
      }
      if (message.type === "instance_created" || message.type === "instance_removed") {
        void queryClient.invalidateQueries({ queryKey: chatsQueryKey });
        return;
      }
    });
  }, [addMessageHandler, artifacts.directory, chatsQueryKey, queryClient, spacesQueryKey]);

  const projectInstancesMap = new Map<string, InstanceInfo>();
  for (const chat of chatSummaries) {
    projectInstancesMap.set(chat.id, chat);
  }
  for (const inst of instances) {
    if (!instanceMatchesProject(inst, projectId)) continue;
    projectInstancesMap.set(inst.id, inst);
  }
  const projectInstances = Array.from(projectInstancesMap.values()).sort(
    (a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0),
  );
  const standaloneInstances = projectInstances.filter(
    (inst) => !isSpaceOwnedInstance(inst, spaces),
  );

  // Build a lookup for parent session names
  const parentNames = new Map<string, string>();
  const instancesBySessionId = new Map<string, InstanceInfo>();
  for (const inst of projectInstances) {
    if (inst.sessionId) {
      instancesBySessionId.set(inst.sessionId, inst);
    }
  }
  for (const inst of projectInstances) {
    if (inst.parentSessionId) {
      const parent = instancesBySessionId.get(inst.parentSessionId);
      if (parent) parentNames.set(inst.id, parent.name);
    }
  }

  const chatsBySpace = new Map<string, InstanceInfo[]>();
  for (const instance of projectInstances) {
    const resolvedSpaceId = getResolvedSpaceId(instance, spaces);
    if (!resolvedSpaceId) continue;
    const chats = chatsBySpace.get(resolvedSpaceId) ?? [];
    chats.push(instance);
    chatsBySpace.set(resolvedSpaceId, chats);
  }
  for (const chats of chatsBySpace.values()) {
    chats.sort((a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0));
  }

  const enrichSpace = (space: SpaceInfo) => ({
    space,
    chats: chatsBySpace.get(space.id) ?? [],
    lastActivity: Math.max(
      space.lastActivityAt || 0,
      ...(chatsBySpace.get(space.id) ?? []).map((chat) => chat.lastActivityAt || 0),
    ),
  });

  const activeSpaces = spaces
    .filter((s) => !s.isDefault && s.status === "active")
    .map(enrichSpace)
    .sort((a, b) => b.lastActivity - a.lastActivity);

  const closedSpaces = spaces
    .filter((s) => !s.isDefault && (s.status === "completed" || s.status === "archived"))
    .map(enrichSpace)
    .sort((a, b) => b.lastActivity - a.lastActivity);

  const matchesSearch = (q: string, space: SpaceInfo, chats: InstanceInfo[]) =>
    space.name.toLowerCase().includes(q) ||
    space.gitBranch?.toLowerCase().includes(q) ||
    chats.some((c) => c.name.toLowerCase().includes(q));

  const filteredStandalone = searchQuery
    ? standaloneInstances.filter(
        (inst) =>
          inst.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          inst.gitBranch?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          inst.lastMessage?.text?.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : standaloneInstances;

  const lq = searchQuery?.toLowerCase() || "";
  const filteredActiveSpaces = searchQuery
    ? activeSpaces.filter(({ space, chats }) => matchesSearch(lq, space, chats))
    : activeSpaces;

  const filteredClosedSpaces = searchQuery
    ? closedSpaces.filter(({ space, chats }) => matchesSearch(lq, space, chats))
    : closedSpaces;

  const hasMainChats = standaloneInstances.length > 0;
  const hasSpaces = activeSpaces.length > 0;

  const handleNewChat = () => {
    if (artifacts.directory) {
      trackInstanceCreate(artifacts.directory);
      send({ type: "create_instance", workingDirectory: artifacts.directory });
    }
  };

  const handleNewSpace = () => {
    if (artifacts.directory) {
      spaceDialog.open(artifacts.directory);
    }
  };

  const searchToolbar =
    standaloneInstances.length > 0 || activeSpaces.length > 0 || closedSpaces.length > 0 ? (
      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
        <Input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search chats..."
          className="h-8 !rounded-md !bg-surface !py-1.5 pl-8 pr-3"
        />
      </div>
    ) : undefined;

  return (
    <PageShell maxWidth="wide" toolbar={searchToolbar}>
      {!hasMainChats && !hasSpaces ? (
        <EmptyState
          icon={<MessageSquare size={24} strokeWidth={1.5} />}
          title="No chats yet"
          description="Start a chat or create a space to get going"
        >
          <div className="mt-5">
            <EmptyProjectActions onNewChat={handleNewChat} onNewSpace={handleNewSpace} />
          </div>
        </EmptyState>
      ) : filteredStandalone.length === 0 &&
        filteredActiveSpaces.length === 0 &&
        filteredClosedSpaces.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-sm text-muted">No chats match "{searchQuery}"</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {/* Active Spaces */}
          {filteredActiveSpaces.length > 0 &&
            filteredActiveSpaces.map(({ space, chats }, index) => (
              <div
                key={space.id}
                className="opacity-0 animate-stagger-fade-in"
                style={{ animationDelay: `${Math.min(index, 8) * 30}ms` }}
              >
                <SpaceCard projectId={projectId} space={space} chats={chats} isMobile={isMobile} />
              </div>
            ))}

          {/* Main workspace chats */}
          {filteredStandalone.length > 0 &&
            filteredStandalone.map((inst, index) => (
              <div
                key={inst.id}
                className="opacity-0 animate-stagger-fade-in"
                style={{ animationDelay: `${Math.min(index, 8) * 30}ms` }}
              >
                <SessionCard
                  instance={inst}
                  parentName={parentNames.get(inst.id)}
                  isMobile={isMobile}
                />
              </div>
            ))}

          {/* Closed Spaces */}
          {filteredClosedSpaces.length > 0 && (
            <ClosedSpacesSection
              spaces={filteredClosedSpaces}
              projectId={projectId}
              isMobile={isMobile}
              defaultOpen={!!searchQuery}
            />
          )}
        </div>
      )}

      <CreateSpaceDialog
        dir={spaceDialog.dir}
        projectName={artifacts.directory?.split("/").pop() || artifacts.directory || ""}
        projectId={projectId}
        onOpenChange={(open) => !open && spaceDialog.close()}
      />
    </PageShell>
  );
}

function ClosedSpacesSection({
  spaces,
  projectId,
  isMobile,
  defaultOpen,
}: {
  spaces: Array<{ space: SpaceInfo; chats: InstanceInfo[]; lastActivity: number }>;
  projectId: string;
  isMobile: boolean;
  defaultOpen: boolean;
}) {
  const [manualToggle, setManualToggle] = useState<boolean | null>(null);
  // Reset manual override when search state changes
  useEffect(() => setManualToggle(null), [defaultOpen]);
  // Auto-open when search is active (defaultOpen=true), but respect manual toggle
  const open = manualToggle ?? defaultOpen;

  return (
    <div>
      <button
        onClick={() => setManualToggle(!open)}
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs font-medium uppercase tracking-wide text-muted transition-colors hover:text-text"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Archive size={12} className="text-muted" />
        Closed spaces ({spaces.length})
      </button>
      {open &&
        spaces.map(({ space, chats }) => (
          <div key={space.id} className="opacity-75">
            <SpaceCard projectId={projectId} space={space} chats={chats} isMobile={isMobile} />
          </div>
        ))}
    </div>
  );
}
