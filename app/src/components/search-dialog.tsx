import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { FolderOpen, GitBranch, Globe, MessageSquare } from "lucide-react";
import { searchChats, type SearchResultItem } from "@/lib/api";
import { useProjectsQuery } from "@/hooks/use-projects-query";
import { formatTimeAgo } from "@/lib/utils";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  CommandGroup,
} from "@/components/ui/command";
import { Dialog } from "@/components/ui/dialog";

export function useSearchDialog() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Only handle Cmd+K (macOS) — skip Ctrl+K which is a text-editing shortcut
      if (e.key === "k" && e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return { open, setOpen };
}

interface SearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SearchDialog({ open, onOpenChange }: SearchDialogProps) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [scope, setScope] = useState<"project" | "global">("project");
  const { projectId } = useParams({ strict: false }) as { projectId?: string };
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setQuery("");
      setDebouncedQuery("");
      setScope(projectId ? "project" : "global");
    }
  }, [open, projectId]);

  const { data: projects = [] } = useProjectsQuery();
  const projectNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projects) map.set(p.id, p.name);
    return map;
  }, [projects]);

  const effectiveProjectId = scope === "project" ? projectId : undefined;

  // Debounce the search query to avoid flickering results on fast typing
  useEffect(() => {
    if (query.trim().length < 2) {
      setDebouncedQuery("");
      return;
    }
    const id = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(id);
  }, [query]);

  const { data: results = [], isFetching } = useQuery({
    queryKey: ["search", debouncedQuery, effectiveProjectId],
    queryFn: () => searchChats(debouncedQuery, { projectId: effectiveProjectId, limit: 20 }),
    enabled: open && debouncedQuery.trim().length >= 2,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const handleSelect = useCallback(
    (result: SearchResultItem) => {
      if (!result.projectId) return; // Cannot navigate without a project
      onOpenChange(false);

      if (result.spaceId) {
        navigate({
          to: "/projects/$projectId/spaces/$spaceId/$chatId",
          params: {
            projectId: result.projectId,
            spaceId: result.spaceId,
            chatId: result.instanceId,
          },
          search: {
            q: query,
            match: result.snippet ?? undefined,
          },
        });
      } else {
        navigate({
          to: "/projects/$projectId/chats/$chatId",
          params: {
            projectId: result.projectId,
            chatId: result.instanceId,
          },
          search: {
            q: query,
            match: result.snippet ?? undefined,
          },
        });
      }
    },
    [navigate, onOpenChange, query],
  );

  const toggleScope = useCallback(() => {
    setScope((s) => (s === "project" ? "global" : "project"));
    inputRef.current?.focus();
  }, []);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="max-w-xl" className="!p-0 !gap-0">
        <Command shouldFilter={false}>
          <div className="flex items-center">
            <CommandInput
              ref={inputRef}
              placeholder={
                scope === "project" && projectId ? "Search this project…" : "Search all projects…"
              }
              value={query}
              onValueChange={setQuery}
              className="!h-10 flex-1"
            />
            {projectId && (
              <button
                type="button"
                onClick={toggleScope}
                className="mr-3 ml-auto flex shrink-0 items-center gap-1 rounded-md border border-border/70 px-2 py-1 text-[0.6875rem] text-muted transition-colors hover:bg-surface-hover hover:text-text"
                title={scope === "project" ? "Search all projects" : "Search this project only"}
              >
                {scope === "project" ? (
                  <>
                    <FolderOpen size={12} />
                    Project
                  </>
                ) : (
                  <>
                    <Globe size={12} />
                    Global
                  </>
                )}
              </button>
            )}
          </div>
          <CommandList className="max-h-80 border-t border-border/70">
            {query.trim().length < 2 ? (
              <div className="py-8 text-center text-sm text-muted">
                Type to search chats{scope === "project" && projectId ? " in this project" : ""}…
              </div>
            ) : results.length === 0 && !isFetching ? (
              <CommandEmpty>No results found.</CommandEmpty>
            ) : (
              <CommandGroup>
                {results.map((result) => (
                  <CommandItem
                    key={`${result.source}-${result.instanceId}`}
                    value={`${result.source}-${result.instanceId}`}
                    onSelect={() => handleSelect(result)}
                    disabled={!result.projectId}
                    className="!py-2.5 !px-3"
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      {/* Title row */}
                      <div className="flex items-center gap-2">
                        <MessageSquare size={13} className="shrink-0 text-muted" />
                        <span className="truncate text-[0.8125rem] font-medium text-text-bright">
                          {result.title}
                        </span>
                      </div>

                      {/* Snippet — skip for title-only matches (redundant with heading) */}
                      {result.snippet && result.matchField !== "title" && (
                        <p
                          className="truncate pl-[21px] text-xs text-muted [&_mark]:bg-accent/25 [&_mark]:text-text-bright [&_mark]:rounded-sm [&_mark]:px-0.5"
                          dangerouslySetInnerHTML={{ __html: result.snippet }}
                        />
                      )}

                      {/* Meta chips */}
                      <div className="flex items-center gap-2 pl-[21px] pt-0.5">
                        {result.matchField && result.matchField !== "title" && (
                          <span className="text-[0.625rem] uppercase tracking-wider text-muted/70">
                            {result.matchField}
                          </span>
                        )}
                        {scope === "global" && result.projectId && (
                          <span className="flex items-center gap-0.5 text-[0.625rem] text-muted/70">
                            <FolderOpen size={10} />
                            {projectNameById.get(result.projectId) ?? "Unknown"}
                          </span>
                        )}
                        {Date.now() - result.lastActivityAt < 86_400_000 && (
                          <span className="rounded bg-accent/15 px-1 py-px text-[0.5625rem] font-medium uppercase tracking-wider text-accent">
                            Recent
                          </span>
                        )}
                        {result.gitBranch && (
                          <span className="flex items-center gap-0.5 text-[0.625rem] text-muted/70">
                            <GitBranch size={10} />
                            {result.gitBranch}
                          </span>
                        )}
                        <span className="text-[0.625rem] text-muted/70">
                          {formatTimeAgo(result.lastActivityAt)}
                        </span>
                      </div>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-border/70 px-3 py-1.5 text-[0.625rem] text-muted">
            <div className="flex items-center gap-3">
              <span>
                <kbd className="rounded border border-border/70 px-1 py-0.5 font-mono text-[0.5625rem]">
                  ↑↓
                </kbd>{" "}
                navigate
              </span>
              <span>
                <kbd className="rounded border border-border/70 px-1 py-0.5 font-mono text-[0.5625rem]">
                  ↵
                </kbd>{" "}
                open
              </span>
              <span>
                <kbd className="rounded border border-border/70 px-1 py-0.5 font-mono text-[0.5625rem]">
                  esc
                </kbd>{" "}
                close
              </span>
            </div>
            {isFetching && <span className="text-muted/60">searching…</span>}
          </div>
        </Command>
      </Dialog.Content>
    </Dialog.Root>
  );
}
