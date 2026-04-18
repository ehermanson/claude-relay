import { useState, useRef, useEffect, useCallback } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DownloadCloud, LogOut, PanelLeftOpen, Plus, Settings } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { SidebarItem } from "@/components/layout/sidebar-item";
import { useAuthContext } from "@/context/auth-context";
import { SidebarActionsProvider } from "@/context/sidebar-actions-context";
import { useSidebarNavigationController } from "@/hooks/use-sidebar-navigation-controller";
import { getInstanceProjectRouteId, getProjectName, getSpaceRoute } from "@/lib/project-route";
import { fetchUpdateStatus, installUpdate } from "@/lib/api";
import type { InstanceInfo, SpaceInfo } from "@shared/types";

// ── Project flyout (sessions for one project) ────────────────────────

function ProjectFlyout({
  dir,
  projectId,
  instances,
  spaces,
  latestChatIdBySpace,
  currentId,
  activeSpaceId,
  onNewChat,
}: {
  dir: string;
  projectId: string;
  instances: InstanceInfo[];
  spaces?: SpaceInfo[];
  latestChatIdBySpace: Record<string, string>;
  currentId?: string;
  activeSpaceId?: string;
  onNewChat: (dir: string) => void;
}) {
  const name = getProjectName(dir);
  const mainInstances = instances.filter((inst) => !inst.spaceId);
  const visibleSpaces =
    spaces?.filter((space) => !space.isDefault && space.status === "active") ?? [];

  return (
    <div className="flex max-h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/50 px-3 py-2.5">
        <Link
          to="/projects/$projectId"
          params={{ projectId }}
          className="min-w-0 truncate text-[0.8125rem] font-semibold text-text-bright transition-colors hover:text-accent"
        >
          {name}
        </Link>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onNewChat(dir)}
          className="hover:!bg-accent/10 hover:!text-accent"
        >
          <Plus size={12} strokeWidth={2.5} />
          New
        </Button>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto px-1 py-1">
        {visibleSpaces.length > 0 && (
          <div className="px-2 pb-2">
            <div className="px-2 py-1 text-[0.625rem] font-semibold uppercase tracking-[0.08em] text-muted/70">
              Spaces
            </div>
            <div className="space-y-0.5">
              {visibleSpaces.map((space) => (
                <Link
                  key={space.id}
                  {...getSpaceRoute(projectId, space.id, latestChatIdBySpace[space.id])}
                  className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-[0.75rem] transition-colors ${
                    activeSpaceId === space.id
                      ? "bg-accent-dim text-accent"
                      : "text-text hover:bg-surface-hover"
                  }`}
                >
                  <span className="truncate font-medium">{space.name}</span>
                  {space.gitBranch && (
                    <span className="truncate text-[0.625rem] text-muted">{space.gitBranch}</span>
                  )}
                </Link>
              ))}
            </div>
          </div>
        )}

        <div className="px-2 pb-1">
          <div className="px-2 py-1 text-[0.625rem] font-semibold uppercase tracking-[0.08em] text-muted/70">
            Chats
          </div>
        </div>

        {mainInstances.length === 0 ? (
          <div className="px-2 py-4 text-center text-[0.75rem] text-muted">No sessions</div>
        ) : (
          mainInstances.map((inst) => (
            <SidebarItem
              key={inst.id}
              instance={inst}
              isActive={inst.id === currentId}
              to="/projects/$projectId/chats/$chatId"
              params={{ projectId: getInstanceProjectRouteId(inst), chatId: inst.id }}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ── Project icon button ──────────────────────────────────────────────

function ProjectIcon({
  dir,
  isActive,
  isHovered,
  hasActivity,
  iconPath,
  onHover,
  onLeave,
}: {
  dir: string;
  isActive: boolean;
  isHovered: boolean;
  hasActivity: boolean;
  iconPath?: string;
  onHover: () => void;
  onLeave: () => void;
}) {
  const name = getProjectName(dir);
  const initial = name.charAt(0).toUpperCase();
  const [imgError, setImgError] = useState(false);
  const showIcon = iconPath && !imgError;

  return (
    <button
      type="button"
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      className={`relative flex h-9 w-9 items-center justify-center rounded-lg text-[0.8125rem] font-bold transition-all duration-150 ${
        isActive
          ? "bg-surface-hover text-text"
          : isHovered
            ? "bg-surface-hover/60 text-text"
            : "text-muted hover:bg-surface-hover hover:text-text"
      }`}
    >
      {showIcon ? (
        <img
          src={`/api/file?path=${encodeURIComponent(iconPath)}`}
          alt={name}
          className={`h-6 w-6 rounded object-contain transition-[filter,opacity] duration-150 ${
            isActive || isHovered ? "opacity-100 grayscale-0" : "opacity-60 grayscale"
          }`}
          onError={() => setImgError(true)}
        />
      ) : (
        <span
          className={`flex h-6 w-6 items-center justify-center rounded-md text-[0.8125rem] font-bold uppercase transition-colors ${
            isActive || isHovered
              ? "bg-surface-raised text-text-bright"
              : "bg-surface-hover text-text-bright/75"
          }`}
        >
          {initial}
        </span>
      )}
      {hasActivity && (
        <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 animate-pulse-dot rounded-full bg-warning" />
      )}
    </button>
  );
}

// ── Main component ───────────────────────────────────────────────────

export function MiniSidebar({ onExpand }: { onExpand: () => void }) {
  const { isAuthenticated, logout } = useAuthContext();
  const queryClient = useQueryClient();
  const { data: updateSnapshot } = useQuery({
    queryKey: ["system-update"],
    queryFn: fetchUpdateStatus,
    staleTime: 30_000,
  });
  const updateAvailable = Boolean(updateSnapshot?.enabled && updateSnapshot.updateAvailable);
  const installMutation = useMutation({
    mutationFn: installUpdate,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["system-update"] });
      toast.success("Relay update installed. Restarting now.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to install update");
    },
  });
  const {
    latestChatIdBySpace,
    currentChatId,
    currentProjectId,
    currentSpaceId,
    projectByDir,
    projectEntries,
    createNewChat,
  } = useSidebarNavigationController();
  const location = useLocation();
  const currentId = currentChatId;

  // Which project flyout is open (by dir path), null = none
  const [flyoutDir, setFlyoutDir] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track the icon element's vertical position for flyout alignment
  const iconRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [flyoutTop, setFlyoutTop] = useState(0);

  const openFlyout = useCallback((dir: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const el = iconRefs.current.get(dir);
    if (el) {
      setFlyoutTop(el.getBoundingClientRect().top);
    }
    setFlyoutDir(dir);
  }, []);

  const closeFlyout = useCallback(() => {
    timerRef.current = setTimeout(() => setFlyoutDir(null), 200);
  }, []);

  const keepFlyout = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  // Close flyout on navigation
  useEffect(() => {
    setFlyoutDir(null);
  }, [location.pathname]);

  const handleNewChat = (dir: string) => {
    createNewChat(dir);
    setFlyoutDir(null);
  };

  const flyoutEntry = flyoutDir ? projectEntries.find((entry) => entry.dir === flyoutDir) : null;

  return (
    <SidebarActionsProvider
      currentProjectId={currentProjectId}
      currentSpaceId={currentSpaceId}
      projectByDir={projectByDir}
      createNewChat={createNewChat}
    >
      <div className="relative flex h-full shrink-0">
        {/* Narrow icon rail */}
        <aside className="flex h-full w-12 flex-col items-center bg-surface py-3 rounded-xl">
          {/* Logo placeholder — the real logo is rendered persistently in app-layout */}
          <div className="mb-3 h-7 w-7" aria-hidden />

          {/* Expand button */}
          <Tooltip content="Expand sidebar" side="right">
            <Button variant="icon" onClick={onExpand} className="mb-2">
              <PanelLeftOpen size={15} strokeWidth={2} />
            </Button>
          </Tooltip>

          <div className="mx-auto mb-2 h-px w-6 bg-border/60" />

          {/* Project icons */}
          <div className="flex flex-1 flex-col items-center gap-1 overflow-y-auto">
            {projectEntries.map((entry) => {
              return (
                <div
                  key={entry.dir}
                  ref={(el) => {
                    if (el) iconRefs.current.set(entry.dir, el);
                    else iconRefs.current.delete(entry.dir);
                  }}
                >
                  <ProjectIcon
                    dir={entry.dir}
                    isActive={entry.isActiveProject}
                    isHovered={flyoutDir === entry.dir}
                    hasActivity={entry.hasActivity}
                    iconPath={entry.iconPath}
                    onHover={() => openFlyout(entry.dir)}
                    onLeave={closeFlyout}
                  />
                </div>
              );
            })}
          </div>

          {/* Footer icons */}
          <div className="mx-auto mt-2 mb-2 h-px w-6 bg-border/60" />
          <div className="flex flex-col items-center gap-1">
            {updateAvailable && (
              <Tooltip content="Install update and restart Relay" side="right">
                <Button
                  variant="icon"
                  disabled={installMutation.isPending}
                  onClick={() => installMutation.mutate()}
                  className="relative !text-amber-400 hover:!bg-amber-500/10 hover:!text-amber-300"
                >
                  <DownloadCloud
                    size={14}
                    className={installMutation.isPending ? "animate-pulse" : ""}
                  />
                  {!installMutation.isPending && (
                    <span className="absolute right-1 top-1 h-1.5 w-1.5 animate-pulse-dot rounded-full bg-amber-400" />
                  )}
                </Button>
              </Tooltip>
            )}
            <Tooltip content="Settings" side="right">
              <Link to="/settings">
                <Button variant="icon">
                  <Settings size={14} />
                </Button>
              </Link>
            </Tooltip>
            {isAuthenticated && (
              <Tooltip content="Sign out" side="right">
                <Button variant="icon" onClick={logout}>
                  <LogOut size={13} />
                </Button>
              </Tooltip>
            )}
          </div>
        </aside>

        {/* Per-project flyout */}
        {flyoutEntry && (
          <div
            className="glass fixed left-[58px] z-50 flex w-64 animate-slide-in-left flex-col overflow-hidden rounded-xl border-0"
            style={{
              top: Math.max(8, Math.min(flyoutTop - 8, window.innerHeight - 400)),
              maxHeight: "min(80vh, 500px)",
            }}
            onMouseEnter={keepFlyout}
            onMouseLeave={closeFlyout}
          >
            <ProjectFlyout
              dir={flyoutEntry.dir}
              projectId={flyoutEntry.projectId}
              instances={flyoutEntry.groupInstances}
              spaces={flyoutEntry.spaces}
              latestChatIdBySpace={latestChatIdBySpace}
              currentId={currentId}
              activeSpaceId={currentSpaceId}
              onNewChat={handleNewChat}
            />
          </div>
        )}
      </div>
    </SidebarActionsProvider>
  );
}
