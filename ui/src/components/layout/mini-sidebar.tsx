import { useState, useRef, useEffect, useCallback } from "react";
import { Link, useParams, useLocation } from "@tanstack/react-router";
import { LogOut, Moon, PanelLeftOpen, Plus, SquareTerminal, Sun } from "lucide-react";
import { useWSMethods, useWSState } from "../../context/websocket-context";
import { useAuthContext } from "../../context/auth-context";
import { useTheme } from "../../context/theme-context";
import { RelayLogo } from "../ui/relay-logo";
import { Tooltip } from "../ui/tooltip";
import { ProviderLogo } from "../chat/input-area/shared";
import { getInstanceProjectRouteId, getProjectName } from "../../lib/project-route";
import { formatTimeAgo } from "../../lib/utils";
import { fetchProjectIcons } from "../../lib/api";
import { useProjectOrder } from "../../hooks/use-project-order";
import type { InstanceInfo, Project } from "@shared/types";

/** Extract project groups sorted by custom project order, sessions within are MRU. */
function useProjectGroups() {
  const { instances } = useWSState();
  const { sortEntries, syncVisibleDirs } = useProjectOrder();
  const groupMap = new Map<string, InstanceInfo[]>();
  for (const inst of instances) {
    const dir = inst.workingDirectory;
    if (!groupMap.has(dir)) groupMap.set(dir, []);
    groupMap.get(dir)!.push(inst);
  }
  for (const group of groupMap.values()) {
    group.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  }
  useEffect(() => {
    syncVisibleDirs([...groupMap.keys()]);
  }, [instances, syncVisibleDirs]);
  // Sort projects by custom order (falls back to alphabetical for new projects)
  return sortEntries([...groupMap.entries()]);
}

// ── Project flyout (sessions for one project) ────────────────────────

function statusDotClass(instance: InstanceInfo): string {
  if (instance.pendingTool) return "animate-pulse-dot bg-warning";
  if (instance.status === "processing") return "animate-pulse-dot bg-warning";
  if (instance.status === "error") return "bg-error";
  if (instance.status === "stopped") return "bg-muted/40";
  return "bg-accent/60";
}

function ProjectFlyout({
  dir,
  projectId,
  instances,
  currentId,
  onNewChat,
}: {
  dir: string;
  projectId: string;
  instances: InstanceInfo[];
  currentId?: string;
  onNewChat: (dir: string) => void;
}) {
  const name = getProjectName(dir);

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
        <button
          onClick={() => onNewChat(dir)}
          className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium text-muted transition-colors hover:bg-surface-hover hover:text-text"
        >
          <Plus size={12} strokeWidth={2.5} />
          New
        </button>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto px-1.5 py-1">
        {instances.length === 0 ? (
          <div className="px-2 py-4 text-center text-[0.75rem] text-muted">No sessions</div>
        ) : (
          instances.map((inst) => {
            const isActive = inst.id === currentId;
            return (
              <Link
                key={inst.id}
                to="/projects/$projectId/chats/$chatId"
                params={{ projectId: getInstanceProjectRouteId(inst), chatId: inst.id }}
                className={`flex items-start gap-2 rounded-lg px-2.5 py-2 transition-colors ${
                  isActive ? "bg-accent-dim text-accent" : "text-text hover:bg-surface-hover"
                }`}
              >
                {/* Status dot */}
                <span className="mt-1.5 flex h-3 w-3 shrink-0 items-center justify-center">
                  {inst.external && (inst.status === "idle" || inst.status === "processing") ? (
                    <SquareTerminal size={11} strokeWidth={2} className="text-muted" />
                  ) : inst.status !== "stopped" ? (
                    <span className={`h-[6px] w-[6px] rounded-full ${statusDotClass(inst)}`} />
                  ) : null}
                </span>
                {/* Name + meta */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="min-w-0 truncate text-[0.8125rem] font-medium leading-tight text-text-bright">
                      {inst.name}
                    </span>
                    <ProviderLogo
                      provider={inst.provider}
                      className="h-3 w-3 shrink-0 text-muted/50"
                      muted
                    />
                  </div>
                  {inst.lastMessage && (
                    <div className="mt-0.5 truncate text-[0.6875rem] leading-tight text-muted">
                      {inst.lastMessage.text}
                    </div>
                  )}
                </div>
                {/* Timestamp */}
                {inst.lastMessage && (
                  <span className="shrink-0 pt-0.5 text-[0.625rem] text-muted/60">
                    {formatTimeAgo(inst.lastMessage.timestamp)}
                  </span>
                )}
              </Link>
            );
          })
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
      className={`relative flex h-9 w-9 items-center justify-center rounded-lg text-[0.8125rem] font-bold transition-colors ${
        isActive || isHovered
          ? "bg-accent/15 text-accent"
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
              ? "bg-accent/10 text-accent"
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
  const { isConnected, projects } = useWSState();
  const { send } = useWSMethods();
  const { logout } = useAuthContext();
  const { theme, toggle: toggleTheme } = useTheme();
  const { chatId: currentId, projectId: currentProjectId } = useParams({ strict: false }) as {
    chatId?: string;
    projectId?: string;
  };
  const location = useLocation();
  const groups = useProjectGroups();
  const projectByDir = new Map<string, Project>();
  for (const project of projects) {
    projectByDir.set(project.directory, project);
  }

  // Fetch project icons once on mount
  const [projectIcons, setProjectIcons] = useState<Record<string, string>>({});
  useEffect(() => {
    fetchProjectIcons()
      .then(setProjectIcons)
      .catch(() => {});
  }, []);

  // Which project flyout is open (by dir path), null = none
  const [flyoutDir, setFlyoutDir] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  // Track the icon element's vertical position for flyout alignment
  const iconRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [flyoutTop, setFlyoutTop] = useState(0);

  const openFlyout = useCallback((dir: string) => {
    clearTimeout(timerRef.current);
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
    clearTimeout(timerRef.current);
  }, []);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  // Close flyout on navigation
  useEffect(() => {
    setFlyoutDir(null);
  }, [location.pathname]);

  const handleNewChat = (dir: string) => {
    send({ type: "create_instance", workingDirectory: dir });
    setFlyoutDir(null);
  };

  const flyoutGroup = flyoutDir ? groups.find(([d]) => d === flyoutDir) : null;

  return (
    <div className="relative flex h-full shrink-0">
      {/* Narrow icon rail */}
      <aside className="flex h-full w-12 flex-col items-center border-r border-border bg-surface py-3">
        {/* Logo */}
        <Link to="/" className="mb-3 rounded-md transition-opacity hover:opacity-80">
          <RelayLogo size={24} connected={isConnected} />
        </Link>

        {/* Expand button */}
        <Tooltip content="Expand sidebar" side="right">
          <button
            onClick={onExpand}
            className="mb-2 flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-hover hover:text-text"
          >
            <PanelLeftOpen size={15} strokeWidth={2} />
          </button>
        </Tooltip>

        <div className="mx-auto mb-2 h-px w-6 bg-border/60" />

        {/* Project icons */}
        <div className="flex flex-1 flex-col items-center gap-1 overflow-y-auto">
          {groups.map(([dir]) => {
            const projectId = projectByDir.get(dir)?.id ?? getProjectName(dir);
            const isActive = currentProjectId === projectId;
            const hasActivity =
              groups.find(([d]) => d === dir)?.[1].some((i) => i.status === "processing") ?? false;

            return (
              <div
                key={dir}
                ref={(el) => {
                  if (el) iconRefs.current.set(dir, el);
                  else iconRefs.current.delete(dir);
                }}
              >
                <ProjectIcon
                  dir={dir}
                  isActive={isActive}
                  isHovered={flyoutDir === dir}
                  hasActivity={hasActivity}
                  iconPath={projectIcons[dir]}
                  onHover={() => openFlyout(dir)}
                  onLeave={closeFlyout}
                />
              </div>
            );
          })}
        </div>

        {/* Footer icons */}
        <div className="mt-2 flex flex-col items-center gap-1">
          <Tooltip content={theme === "dark" ? "Light mode" : "Dark mode"} side="right">
            <button
              onClick={toggleTheme}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-hover hover:text-text"
            >
              {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
            </button>
          </Tooltip>
          <Tooltip content="Sign out" side="right">
            <button
              onClick={logout}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-hover hover:text-text"
            >
              <LogOut size={13} />
            </button>
          </Tooltip>
        </div>
      </aside>

      {/* Per-project flyout */}
      {flyoutGroup && (
        <div
          className="fixed left-12 z-50 flex w-64 animate-slide-in-left flex-col overflow-hidden rounded-r-xl border border-l-0 border-border bg-surface shadow-xl"
          style={{
            top: Math.max(8, Math.min(flyoutTop - 8, window.innerHeight - 400)),
            maxHeight: "min(80vh, 500px)",
          }}
          onMouseEnter={keepFlyout}
          onMouseLeave={closeFlyout}
        >
          <ProjectFlyout
            dir={flyoutGroup[0]}
            projectId={projectByDir.get(flyoutGroup[0])?.id ?? getProjectName(flyoutGroup[0])}
            instances={flyoutGroup[1]}
            currentId={currentId}
            onNewChat={handleNewChat}
          />
        </div>
      )}
    </div>
  );
}
