import type { RefObject } from "react";
import type { MentionEntry, SlashMenuItem } from "@/components/chat/input-area/shared";
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

export function MentionMenu({
  isMobile,
  mentionEntries,
  selectedMentionKey,
  onSelectMentionKey,
  onApplyMentionEntry,
  mentionListRef,
}: {
  isMobile: boolean;
  mentionEntries: MentionEntry[];
  selectedMentionKey: string | null;
  onSelectMentionKey: (value: string) => void;
  onApplyMentionEntry: (entry: MentionEntry) => void;
  mentionListRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      className={`pointer-events-none absolute inset-x-2 z-20 ${isMobile ? "bottom-24" : "bottom-[7rem]"}`}
    >
      <div className="pointer-events-auto overflow-hidden rounded-2xl border border-border/80 bg-surface-raised/95 shadow-lg backdrop-blur">
        <Command
          shouldFilter={false}
          value={selectedMentionKey ?? undefined}
          onValueChange={onSelectMentionKey}
          className="bg-transparent p-0"
        >
          <CommandList ref={mentionListRef} className="max-h-72 p-1">
            <CommandEmpty>No matching files or folders.</CommandEmpty>
            <CommandGroup>
              {mentionEntries.map((entry) => {
                const basename = entry.path.split("/").pop() || entry.path;
                const parentPath = entry.path.slice(
                  0,
                  Math.max(0, entry.path.length - basename.length - 1),
                );

                return (
                  <CommandItem
                    key={entry.path}
                    value={entry.path}
                    data-menu-item-id={entry.path}
                    onMouseEnter={() => onSelectMentionKey(entry.path)}
                    onMouseDown={(e) => e.preventDefault()}
                    onSelect={() => onApplyMentionEntry(entry)}
                    className="justify-between gap-2.5 py-2"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2.5">
                      <FileIcon
                        path={entry.path}
                        kind={entry.kind}
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
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </div>
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
      className={`pointer-events-none absolute inset-x-2 z-20 ${isMobile ? "bottom-24" : "bottom-[7rem]"}`}
    >
      <div className="pointer-events-auto overflow-hidden rounded-2xl border border-border/80 bg-surface-raised/95 shadow-lg backdrop-blur">
        <Command
          shouldFilter={false}
          value={selectedSlashKey ?? undefined}
          onValueChange={onSelectSlashKey}
          className="bg-transparent p-0"
        >
          <CommandList ref={slashListRef} className="max-h-72 p-1">
            <CommandEmpty>No matching slash commands.</CommandEmpty>
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
                      className="gap-2.5 py-1.5 flex items-center"
                    >
                      <span className="truncate text-[0.8125rem] font-medium text-text">
                        {item.title}
                      </span>
                      {item.hint ? (
                        <Badge
                          variant={item.accent ? "accent" : "default"}
                          className="px-2 py-0.5 text-[0.6875rem]"
                        >
                          {item.hint}
                        </Badge>
                      ) : null}
                      <div className="truncate pt-0.5 text-[0.6875rem] text-muted">
                        {item.description}
                      </div>
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
