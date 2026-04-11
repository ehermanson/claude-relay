import type { RefObject } from "react";
import {
  mentionEntryKey,
  type MentionEntry,
  type SlashMenuItem,
} from "@/components/chat/input-area/shared";
import { Badge } from "@/components/ui/badge";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { FileIcon } from "@/components/ui/file-icon";
import { Spinner } from "@/components/ui/spinner";
import { ListChecks } from "lucide-react";

const PRIORITY_LABELS: Record<number, string> = {
  0: "P0",
  1: "P1",
  2: "P2",
  3: "P3",
  4: "P4",
};

const PRIORITY_COLORS: Record<number, string> = {
  0: "bg-red-500/15 text-red-400",
  1: "bg-orange-500/15 text-orange-400",
  2: "bg-yellow-500/15 text-yellow-400",
  3: "bg-blue-500/15 text-blue-400",
  4: "bg-zinc-500/15 text-zinc-400",
};

const ITEM_BASE =
  "relative flex cursor-default items-center gap-2 rounded-xl px-2.5 py-1.5 text-sm text-text outline-none select-none";
const ITEM_SELECTED = "bg-surface-hover text-text ring-1 ring-border/80";

export function MentionMenu({
  isMobile,
  mentionEntries,
  loading,
  selectedMentionKey,
  onSelectMentionKey,
  onApplyMentionEntry,
  mentionListRef,
}: {
  isMobile: boolean;
  mentionEntries: MentionEntry[];
  loading?: boolean;
  selectedMentionKey: string | null;
  onSelectMentionKey: (value: string) => void;
  onApplyMentionEntry: (entry: MentionEntry) => void;
  mentionListRef: RefObject<HTMLDivElement | null>;
}) {
  const fileEntries = mentionEntries.filter((e) => e.kind !== "task");
  const taskEntries = mentionEntries.filter((e) => e.kind === "task");
  const hasFiles = fileEntries.length > 0;
  const hasTasks = taskEntries.length > 0;

  return (
    <div
      className={`pointer-events-none absolute inset-x-2 z-20 ${isMobile ? "bottom-24" : "bottom-[5.5rem]"}`}
    >
      <div className="pointer-events-auto overflow-hidden rounded-2xl border border-border/80 bg-surface-raised/95 shadow-lg backdrop-blur">
        <div
          ref={mentionListRef}
          className="max-h-72 overflow-x-hidden overflow-y-auto p-1"
          role="listbox"
        >
          {!loading && !hasFiles && !hasTasks && (
            <div className="py-6 text-center text-sm text-muted">
              No matching files, folders, or tasks.
            </div>
          )}

          {/* Files section */}
          {loading && !hasFiles ? (
            <MentionGroup heading={hasTasks ? "Files" : undefined}>
              <div className="flex items-center gap-2 px-2 py-2 text-[0.8125rem] text-muted">
                <Spinner size={12} className="text-muted" />
                <span>Searching files…</span>
              </div>
            </MentionGroup>
          ) : hasFiles ? (
            <MentionGroup heading={hasTasks ? "Files" : undefined}>
              {fileEntries.map((entry) => {
                const fileEntry = entry as Extract<MentionEntry, { kind: "file" | "directory" }>;
                const key = mentionEntryKey(entry);
                const basename = fileEntry.path.split("/").pop() || fileEntry.path;
                const parentPath = fileEntry.path.slice(
                  0,
                  Math.max(0, fileEntry.path.length - basename.length - 1),
                );
                const selected = key === selectedMentionKey;

                return (
                  <div
                    key={key}
                    role="option"
                    aria-selected={selected}
                    data-menu-item-id={key}
                    onMouseEnter={() => onSelectMentionKey(key)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => onApplyMentionEntry(entry)}
                    className={`${ITEM_BASE} justify-between gap-2.5 py-2 ${selected ? ITEM_SELECTED : ""}`}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2.5">
                      <FileIcon
                        path={fileEntry.path}
                        kind={fileEntry.kind}
                        className="h-3.5 w-3.5 shrink-0"
                      />
                      <div className="min-w-0 flex flex-1 items-baseline gap-2">
                        <div className="truncate text-[0.8125rem] font-medium text-text">
                          {basename}
                        </div>
                        {parentPath ? (
                          <div className="truncate text-[0.75rem] text-muted">{parentPath}</div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </MentionGroup>
          ) : null}

          {(hasFiles || loading) && hasTasks && <div className="-mx-1 my-1 h-px bg-border/70" />}

          {hasTasks && (
            <MentionGroup heading="Tasks">
              {taskEntries.map((entry) => {
                const taskEntry = entry as Extract<MentionEntry, { kind: "task" }>;
                const key = mentionEntryKey(entry);
                const priorityLabel =
                  PRIORITY_LABELS[taskEntry.priority] ?? `P${taskEntry.priority}`;
                const priorityColor = PRIORITY_COLORS[taskEntry.priority] ?? PRIORITY_COLORS[4];
                const selected = key === selectedMentionKey;

                return (
                  <div
                    key={key}
                    role="option"
                    aria-selected={selected}
                    data-menu-item-id={key}
                    onMouseEnter={() => onSelectMentionKey(key)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => onApplyMentionEntry(entry)}
                    className={`${ITEM_BASE} gap-2.5 py-2 ${selected ? ITEM_SELECTED : ""}`}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2.5">
                      <ListChecks size={14} className="shrink-0 text-muted" />
                      <div className="min-w-0 flex flex-1 items-baseline gap-2">
                        <div className="truncate text-[0.8125rem] font-medium text-text">
                          {taskEntry.title}
                        </div>
                        <Badge className={`shrink-0 px-1.5 py-0 text-[0.625rem] ${priorityColor}`}>
                          {priorityLabel}
                        </Badge>
                        <div className="truncate text-[0.6875rem] text-muted">{taskEntry.type}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </MentionGroup>
          )}
        </div>
      </div>
    </div>
  );
}

function MentionGroup({ heading, children }: { heading?: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden p-1 text-text">
      {heading && (
        <div className="px-2 pb-1 text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-muted">
          {heading}
        </div>
      )}
      {children}
    </div>
  );
}

export function SlashMenu({
  isMobile,
  slashGroups,
  selectedSlashKey,
  onSelectSlashKey,
  slashListRef,
}: {
  isMobile: boolean;
  slashGroups: Array<{ heading: string; items: SlashMenuItem[] }>;
  selectedSlashKey: string | null;
  onSelectSlashKey: (value: string) => void;
  slashListRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      className={`pointer-events-none absolute inset-x-2 z-20 ${isMobile ? "bottom-24" : "bottom-[5.5rem]"}`}
    >
      <div className="pointer-events-auto overflow-hidden rounded-2xl border border-border/80 bg-surface-raised/95 shadow-lg backdrop-blur">
        <Command
          shouldFilter={false}
          value={selectedSlashKey ?? undefined}
          onValueChange={onSelectSlashKey}
          className="bg-transparent p-0"
        >
          <CommandList ref={slashListRef} className="max-h-72 p-1">
            <CommandEmpty>No matching commands.</CommandEmpty>
            {slashGroups.map((group, groupIndex) => (
              <div key={group.heading}>
                {groupIndex > 0 ? <CommandSeparator /> : null}
                <CommandGroup>
                  {group.items.map((item) => (
                    <CommandItem
                      key={item.key}
                      value={item.key}
                      data-menu-item-id={item.key}
                      onMouseEnter={() => onSelectSlashKey(item.key)}
                      onMouseDown={(e) => e.preventDefault()}
                      onSelect={item.onSelect}
                      className="gap-1 py-1.5 flex flex-col items-start"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="shrink-0 text-[0.8125rem] font-medium text-text">
                          {item.title}
                        </span>
                        {item.hint ? (
                          <Badge
                            variant={item.accent ? "accent" : "default"}
                            className="shrink-0 px-2 py-0.5 text-[0.6875rem]"
                          >
                            {item.hint}
                          </Badge>
                        ) : null}
                      </div>
                      {item.description ? (
                        <div className="text-[0.6875rem] leading-snug text-muted">
                          {item.description}
                        </div>
                      ) : null}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </div>
            ))}
          </CommandList>
        </Command>
      </div>
    </div>
  );
}
