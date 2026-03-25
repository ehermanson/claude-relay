import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, ExternalLink, FolderOpen, TerminalSquare } from "lucide-react";
import { toast } from "sonner";
import {
  siAndroidstudio,
  siCursor,
  siApple,
  siWarp,
  siWindsurf,
  siXcode,
  siZedindustries,
} from "simple-icons";
import type { NativeOpenTarget } from "@shared/types";
import { fetchOpenTargets, openNativePath } from "../../lib/api";
import { useTheme } from "../../context/theme-context";
import { Menu } from "../ui/menu";
import { Tooltip } from "../ui/tooltip";

interface OpenInMenuProps {
  path?: string | null;
  compact?: boolean;
  className?: string;
}

const OPEN_TARGET_STORAGE_KEY = "relay.open-target";

const GHOSTTY_ICON_PATH =
  "M12 0C6.7 0 2.4 4.3 2.4 9.6v11.146c0 1.772 1.45 3.267 3.222 3.254a3.18 3.18 0 0 0 1.955-.686 1.96 1.96 0 0 1 2.444 0 3.18 3.18 0 0 0 1.976.686c.75 0 1.436-.257 1.98-.686.715-.563 1.71-.587 2.419-.018.59.476 1.355.743 2.182.699 1.705-.094 3.022-1.537 3.022-3.244V9.601C21.6 4.3 17.302 0 12 0M6.069 6.562a1 1 0 0 1 .46.131l3.578 2.065v.002a.974.974 0 0 1 0 1.687L6.53 12.512a.975.975 0 0 1-.976-1.687L7.67 9.602 5.553 8.38a.975.975 0 0 1 .515-1.818m7.438 2.063h4.7a.975.975 0 1 1 0 1.95h-4.7a.975.975 0 0 1 0-1.95";
const VSCODE_ICON_PATH =
  "M30.865 3.448l-6.583-3.167c-0.766-0.37-1.677-0.214-2.276 0.385l-12.609 11.505-5.495-4.167c-0.51-0.391-1.229-0.359-1.703 0.073l-1.76 1.604c-0.583 0.526-0.583 1.443-0.005 1.969l4.766 4.349-4.766 4.349c-0.578 0.526-0.578 1.443 0.005 1.969l1.76 1.604c0.479 0.432 1.193 0.464 1.703 0.073l5.495-4.172 12.615 11.51c0.594 0.599 1.505 0.755 2.271 0.385l6.589-3.172c0.693-0.333 1.13-1.031 1.13-1.802v-21.495c0-0.766-0.443-1.469-1.135-1.802zM24.005 23.266l-9.573-7.266 9.573-7.266z";

function SimpleIconGlyph({
  pathData,
  className = "",
  viewBox = "0 0 24 24",
}: {
  pathData: string;
  className?: string;
  viewBox?: string;
}) {
  return (
    <svg viewBox={viewBox} aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 ${className}`}>
      <path fill="currentColor" d={pathData} />
    </svg>
  );
}

function OpenTargetIcon({ target, className }: { target: NativeOpenTarget; className?: string }) {
  switch (target.id) {
    case "cursor":
      return <SimpleIconGlyph pathData={siCursor.path} className={className} />;
    case "vscode":
      return (
        <SimpleIconGlyph pathData={VSCODE_ICON_PATH} className={className} viewBox="0 0 32 32" />
      );
    case "windsurf":
      return <SimpleIconGlyph pathData={siWindsurf.path} className={className} />;
    case "zed":
      return <SimpleIconGlyph pathData={siZedindustries.path} className={className} />;
    case "xcode":
      return <SimpleIconGlyph pathData={siXcode.path} className={className} />;
    case "android-studio":
      return <SimpleIconGlyph pathData={siAndroidstudio.path} className={className} />;
    case "warp":
      return <SimpleIconGlyph pathData={siWarp.path} className={className} />;
    case "ghostty":
      return <SimpleIconGlyph pathData={GHOSTTY_ICON_PATH} className={className} />;
    case "finder":
      return <FolderOpen size={14} strokeWidth={2} className={`shrink-0 ${className}`} />;
    case "system-default":
      if (target.label === "Finder") {
        return <SimpleIconGlyph pathData={siApple.path} className={className} />;
      }
      return <FolderOpen size={14} strokeWidth={2} className={`shrink-0 ${className}`} />;
    default:
      if (target.kind === "terminal") {
        return <TerminalSquare size={14} strokeWidth={2} className={`shrink-0 ${className}`} />;
      }
      if (target.kind === "finder" || target.kind === "file-manager") {
        return <FolderOpen size={14} strokeWidth={2} className={`shrink-0 ${className}`} />;
      }
      return <ExternalLink size={14} strokeWidth={2} className={`shrink-0 ${className}`} />;
  }
}

export function OpenInMenu({ path, compact = false, className = "" }: OpenInMenuProps) {
  const { theme } = useTheme();
  const openTargetPath = path ?? "";
  const { data: openTargetsData, isLoading: loading } = useQuery({
    queryKey: ["openTargets", openTargetPath],
    queryFn: () => fetchOpenTargets(openTargetPath),
    enabled: openTargetPath.length > 0,
  });
  const targets = openTargetsData?.targets ?? [];
  const preferredTargetId = openTargetsData?.preferredTargetId ?? null;
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [openingTargetId, setOpeningTargetId] = useState<string | null>(null);

  useEffect(() => {
    if (!path || targets.length === 0) {
      setSelectedTargetId(null);
      return;
    }

    const validIds = new Set(targets.map((target) => target.id));
    let storedTargetId: string | null = null;
    try {
      storedTargetId = window.localStorage.getItem(`${OPEN_TARGET_STORAGE_KEY}:${path}`);
    } catch {
      storedTargetId = null;
    }

    const nextTargetId =
      (storedTargetId && validIds.has(storedTargetId) ? storedTargetId : null) ||
      (preferredTargetId && validIds.has(preferredTargetId) ? preferredTargetId : null) ||
      targets[0]?.id ||
      null;

    setSelectedTargetId(nextTargetId);
  }, [path, preferredTargetId, targets]);

  const selectedTarget = selectedTargetId
    ? (targets.find((target) => target.id === selectedTargetId) ?? null)
    : (targets[0] ?? null);

  if (!path || (!loading && targets.length === 0)) {
    return null;
  }

  const triggerLabel = selectedTarget ? `Open in ${selectedTarget.label}` : "Open in";
  const triggerTooltip = selectedTarget ? `Open in ${selectedTarget.label}` : "Open in another app";
  const iconClassName = theme === "light" ? "text-black/70" : "text-white/80";

  const rememberSelection = (targetId: string) => {
    setSelectedTargetId(targetId);
    try {
      if (path) {
        window.localStorage.setItem(`${OPEN_TARGET_STORAGE_KEY}:${path}`, targetId);
      }
    } catch {
      // Ignore storage failures in private mode or restrictive browsers.
    }
  };

  const handleOpenTarget = async (targetId: string) => {
    if (!path) return;
    setOpeningTargetId(targetId);
    try {
      await openNativePath({
        path,
        targetId,
        rememberForProject: true,
      });
      rememberSelection(targetId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to open path");
    } finally {
      setOpeningTargetId(null);
    }
  };

  return (
    <Menu.Root>
      <Tooltip content={compact ? triggerTooltip : "Open this project in another app"}>
        <div
          className={`flex h-7 items-center overflow-hidden rounded-md border border-border/50 bg-transparent text-xs text-muted ${className}`}
        >
          <button
            type="button"
            disabled={loading || openingTargetId !== null || !selectedTarget}
            onClick={() => {
              if (selectedTarget) void handleOpenTarget(selectedTarget.id);
            }}
            className={`flex h-full min-w-0 items-center gap-2 transition-colors hover:bg-surface-hover hover:text-text disabled:cursor-not-allowed disabled:opacity-40 ${compact ? "px-1.5" : "px-2.5"}`}
          >
            {selectedTarget ? (
              <OpenTargetIcon target={selectedTarget} className={iconClassName} />
            ) : (
              <span aria-hidden="true" className="h-3.5 w-3.5 shrink-0 rounded-sm bg-border/50" />
            )}
            {!compact && <span className="min-w-0 flex-1 truncate text-left">{triggerLabel}</span>}
          </button>
          <span aria-hidden="true" className="h-4 w-px shrink-0 bg-border/60" />
          <Menu.Trigger
            disabled={loading || openingTargetId !== null}
            className="flex h-full w-7 items-center justify-center transition-colors hover:bg-surface-hover hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronDown size={12} strokeWidth={2} />
          </Menu.Trigger>
        </div>
      </Tooltip>
      <Menu.Content align="end" className="min-w-[15rem]">
        {targets.map((target) => {
          const isSelected = selectedTargetId === target.id;
          const isOpening = openingTargetId === target.id;
          return (
            <Menu.Item
              key={target.id}
              disabled={isOpening}
              onClick={() => {
                void handleOpenTarget(target.id);
              }}
            >
              <OpenTargetIcon target={target} className={iconClassName} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{target.label}</span>
              </span>
              {isSelected && <Check size={14} strokeWidth={2.5} className="shrink-0" />}
            </Menu.Item>
          );
        })}
      </Menu.Content>
    </Menu.Root>
  );
}
