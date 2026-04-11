import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";
import type { ProviderSkill, ProviderSlashCommand, ReasoningEffort, Task } from "@shared/types";
import { fetchWorkspaceEntries } from "../../../lib/api";
import { detectMentionTrigger, replacePromptRange } from "../../../lib/composer-mentions";
import { MentionMenu, SlashMenu } from "./overlay-menus";
import {
  SLASH_COMMANDS,
  getCommandContext,
  matchesQuery,
  mentionEntryKey,
  type MentionEntry,
  type SlashMenuItem,
} from "./shared";
import { searchProviderSkills, searchProviderSlashCommands } from "./command-search";

interface ModelOption {
  value: string | null;
  label: string;
  commandValue: string;
}

interface UseComposerMenusParams {
  instanceId: string;
  isMobile: boolean;
  slashCommands?: ProviderSlashCommand[];
  skills?: ProviderSkill[];
  tasks?: Task[] | null;
  draftText: string;
  composerSelectionOffset: number;
  mentionEntries: MentionEntry[];
  selectedMentionKey: string | null;
  mentionMenuDismissed: boolean;
  selectedSlashKey: string | null;
  slashMenuDismissed: boolean;
  preferredModel?: string;
  reasoningBudget?: number;
  modelLabel: string;
  reasoningBudgetLevels?: { budget: number; label: string; description: string }[];
  reasoningEffortLevels?: { effort: ReasoningEffort; label: string; description: string }[];
  supportsModelSelection: boolean;
  supportsReasoningSelection: boolean;
  supportsReasoningEffort: boolean;
  currentReasoningEffort?: ReasoningEffort;
  modelOptions: readonly ModelOption[];
  composerContainerRef: RefObject<HTMLDivElement | null>;
  mentionListRef: RefObject<HTMLDivElement | null>;
  slashListRef: RefObject<HTMLDivElement | null>;
  setComposerValue: (value: string, selectionOffset?: number) => void;
  setMentionEntries: (entries: MentionEntry[]) => void;
  setSelectedMentionKey: (value: string | null | ((prev: string | null) => string | null)) => void;
  dismissMentionMenu: () => void;
  resetMentionMenu: () => void;
  setSelectedSlashKey: (value: string | null | ((prev: string | null) => string | null)) => void;
  dismissSlashMenu: () => void;
  applySlashAction: (action: () => void) => void;
  setModel: (model: string | null) => void;
  setReasoningBudget: (budget: number | null) => void;
  setReasoningEffort: (effort: ReasoningEffort | null) => void;
  onCancel: () => void;
  onSend: () => void;
}

function getNextIndex(currentIndex: number, length: number, direction: "next" | "prev") {
  if (length === 0) return -1;
  if (direction === "next") {
    return currentIndex < 0 ? 0 : Math.min(currentIndex + 1, length - 1);
  }
  return currentIndex < 0 ? 0 : Math.max(currentIndex - 1, 0);
}

function groupSlashMenuItems(items: SlashMenuItem[]) {
  return items.reduce<Array<{ heading: string; items: SlashMenuItem[] }>>((groups, item) => {
    const group = groups.find((entry) => entry.heading === item.category);
    if (group) {
      group.items.push(item);
      return groups;
    }
    groups.push({ heading: item.category, items: [item] });
    return groups;
  }, []);
}

function formatSkillTitle(skill: ProviderSkill): string {
  return `${skill.invocationPrefix ?? "/"}${skill.name}`;
}

function describeSkill(skill: ProviderSkill): string {
  return skill.shortDescription ?? skill.description ?? "";
}

export function useComposerMenus({
  instanceId,
  isMobile,
  slashCommands,
  skills,
  tasks,
  draftText,
  composerSelectionOffset,
  mentionEntries,
  selectedMentionKey,
  mentionMenuDismissed,
  selectedSlashKey,
  slashMenuDismissed,
  preferredModel,
  reasoningBudget,
  modelLabel,
  reasoningBudgetLevels,
  reasoningEffortLevels,
  supportsModelSelection,
  supportsReasoningSelection,
  supportsReasoningEffort,
  currentReasoningEffort,
  modelOptions,
  composerContainerRef,
  mentionListRef,
  slashListRef,
  setComposerValue,
  setMentionEntries,
  setSelectedMentionKey,
  dismissMentionMenu,
  resetMentionMenu,
  setSelectedSlashKey,
  dismissSlashMenu,
  applySlashAction,
  setModel,
  setReasoningBudget,
  setReasoningEffort,
  onCancel,
  onSend,
}: UseComposerMenusParams) {
  const mentionTrigger = !mentionMenuDismissed
    ? detectMentionTrigger(draftText, composerSelectionOffset)
    : null;

  const mentionLoadingRef = useRef(false);
  const [mentionLoading, setMentionLoading] = useState(false);

  // Build task entries from in-memory data (synchronous — no fetch needed)
  const buildTaskEntries = (query: string): MentionEntry[] => {
    const q = query.toLowerCase();
    return (tasks ?? [])
      .filter(
        (t) =>
          t.status === "open" &&
          !t.deleted &&
          (q === "" ||
            q === "task" ||
            q.startsWith("task") ||
            t.title.toLowerCase().includes(q) ||
            t.id.toLowerCase().includes(q)),
      )
      .sort((a, b) => a.priority - b.priority || b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 10)
      .map((t) => ({
        kind: "task" as const,
        taskId: t.id,
        title: t.title,
        description: t.description,
        priority: t.priority,
        type: t.type,
      }));
  };

  useEffect(() => {
    if (!mentionTrigger) {
      setMentionEntries([]);
      setSelectedMentionKey(null);
      mentionLoadingRef.current = false;
      setMentionLoading(false);
      return;
    }

    // Show task results immediately (they're already in memory)
    const taskEntries = buildTaskEntries(mentionTrigger.query);
    if (taskEntries.length > 0) {
      setMentionEntries(taskEntries);
      setSelectedMentionKey((prev) => {
        if (prev && taskEntries.some((e) => mentionEntryKey(e) === prev)) return prev;
        return mentionEntryKey(taskEntries[0]);
      });
    }

    mentionLoadingRef.current = true;
    setMentionLoading(true);

    let cancelled = false;

    const doFetch = async () => {
      const result = await fetchWorkspaceEntries(instanceId, mentionTrigger.query);
      if (cancelled) return;

      const freshTaskEntries = buildTaskEntries(mentionTrigger.query);
      const merged: MentionEntry[] = [...result.entries, ...freshTaskEntries];
      setMentionEntries(merged);
      mentionLoadingRef.current = false;
      setMentionLoading(false);
      setSelectedMentionKey((prev) => {
        if (prev && merged.some((entry) => mentionEntryKey(entry) === prev)) {
          return prev;
        }
        return merged[0] ? mentionEntryKey(merged[0]) : null;
      });
    };

    // Skip debounce for the initial empty query — fire immediately
    if (mentionTrigger.query === "") {
      doFetch();
    } else {
      const timeoutId = window.setTimeout(doFetch, 120);
      return () => {
        cancelled = true;
        window.clearTimeout(timeoutId);
      };
    }

    return () => {
      cancelled = true;
    };
  }, [
    instanceId,
    tasks,
    mentionTrigger?.query,
    mentionTrigger?.rangeEnd,
    mentionTrigger?.rangeStart,
    setMentionEntries,
    setSelectedMentionKey,
  ]);

  const applyMentionEntry = (entry: MentionEntry) => {
    if (!mentionTrigger) return;

    let replacement: string;
    if (entry.kind === "task") {
      const encodedTitle = encodeURIComponent(entry.title);
      replacement = `@task:${entry.taskId}:${encodedTitle} `;
    } else {
      replacement = `@${entry.path} `;
    }

    const next = replacePromptRange(
      draftText,
      mentionTrigger.rangeStart,
      mentionTrigger.rangeEnd,
      replacement,
    );
    setComposerValue(next.value, next.cursor);
    setMentionEntries([]);
    setSelectedMentionKey(null);
    resetMentionMenu();
  };

  const rawCommandContext = !slashMenuDismissed ? getCommandContext(draftText) : null;
  // Suppress the menu when the user is typing arguments after a skill token
  const slashContext =
    rawCommandContext?.hasArgument &&
    skills?.some(
      (s) =>
        (s.invocationPrefix ?? "/") === rawCommandContext.prefix &&
        s.name === rawCommandContext.commandQuery,
    )
      ? null
      : rawCommandContext;

  const slashMenuItems: SlashMenuItem[] = (() => {
    if (!slashContext) return [];

    if (!slashContext.hasArgument) {
      const builtInCommandItems: SlashMenuItem[] =
        slashContext.prefix === "/"
          ? SLASH_COMMANDS.filter((command) => {
              if (command.id === "model" && !supportsModelSelection) return false;
              if (command.id === "reasoning" && !supportsReasoningSelection) return false;
              if (command.id === "effort" && !supportsReasoningEffort) return false;
              return matchesQuery(slashContext.commandQuery, [command.id, command.title.slice(1)]);
            }).map((command) => ({
              key: command.id,
              category: command.category,
              title: command.title,
              description: command.description,
              hint:
                command.id === "model"
                  ? modelLabel
                  : command.id === "reasoning"
                    ? (reasoningBudgetLevels?.find((l) => l.budget === reasoningBudget)?.label ??
                      "Default")
                    : command.id === "effort"
                      ? (reasoningEffortLevels?.find((l) => l.effort === currentReasoningEffort)
                          ?.label ?? "Default")
                      : undefined,
              actionHint: "Tab",
              onSelect: () => setComposerValue(`${command.title} `),
            }))
          : [];

      const providerCommandItems: SlashMenuItem[] =
        slashContext.prefix === "/"
          ? searchProviderSlashCommands([...(slashCommands ?? [])], slashContext.commandQuery).map(
              (command) => ({
                key: `provider-command-${command.name}`,
                category: "Provider Command",
                title: `/${command.name}`,
                description: command.description ?? command.input?.hint ?? "Run provider command",
                actionHint: "Enter",
                onSelect: () => setComposerValue(`/${command.name} `),
              }),
            )
          : [];

      const skillItems: SlashMenuItem[] = searchProviderSkills(
        (skills ?? []).filter((skill) => (skill.invocationPrefix ?? "/") === slashContext.prefix),
        slashContext.commandQuery,
      ).map((skill) => ({
        key: `skill-${skill.name}`,
        category: "Skill",
        title: formatSkillTitle(skill),
        description: describeSkill(skill),
        actionHint: "Enter",
        onSelect: () => setComposerValue(`${formatSkillTitle(skill)} `),
      }));

      return [...builtInCommandItems, ...providerCommandItems, ...skillItems];
    }

    if (
      slashContext.prefix === "/" &&
      slashContext.commandQuery === "model" &&
      supportsModelSelection
    ) {
      return modelOptions
        .filter((option) =>
          matchesQuery(slashContext.argQuery, [option.commandValue, option.label.toLowerCase()]),
        )
        .map((option) => ({
          key: `model-${option.commandValue}`,
          category: "Model",
          title: option.label,
          description: option.value ? option.value : "Uses the active model",
          hint: preferredModel === option.value ? "Current" : undefined,
          actionHint: "Enter",
          accent: preferredModel === option.value,
          onSelect: () => applySlashAction(() => setModel(option.value)),
        }));
    }

    if (
      slashContext.prefix === "/" &&
      slashContext.commandQuery === "reasoning" &&
      supportsReasoningSelection &&
      reasoningBudgetLevels
    ) {
      const items: SlashMenuItem[] = [];
      if (matchesQuery(slashContext.argQuery, ["default", "auto"])) {
        items.push({
          key: "reasoning-default",
          category: "Reasoning",
          title: "Default",
          description: "Uses the model default reasoning effort",
          hint: reasoningBudget == null ? "Current" : undefined,
          actionHint: "Enter",
          accent: reasoningBudget == null,
          onSelect: () => applySlashAction(() => setReasoningBudget(null)),
        });
      }
      for (const level of reasoningBudgetLevels) {
        if (
          matchesQuery(slashContext.argQuery, [level.label.toLowerCase(), String(level.budget)])
        ) {
          items.push({
            key: `reasoning-${level.budget}`,
            category: "Reasoning",
            title: level.label,
            description: level.description,
            hint: reasoningBudget === level.budget ? "Current" : undefined,
            actionHint: "Enter",
            accent: reasoningBudget === level.budget,
            onSelect: () => applySlashAction(() => setReasoningBudget(level.budget)),
          });
        }
      }
      return items;
    }

    if (
      slashContext.prefix === "/" &&
      slashContext.commandQuery === "effort" &&
      supportsReasoningEffort &&
      reasoningEffortLevels
    ) {
      const items: SlashMenuItem[] = [];
      if (matchesQuery(slashContext.argQuery, ["default", "auto"])) {
        items.push({
          key: "effort-default",
          category: "Effort",
          title: "Default",
          description: "Uses the model default effort",
          hint: !currentReasoningEffort ? "Current" : undefined,
          actionHint: "Enter",
          accent: !currentReasoningEffort,
          onSelect: () => applySlashAction(() => setReasoningEffort(null)),
        });
      }
      for (const level of reasoningEffortLevels) {
        if (matchesQuery(slashContext.argQuery, [level.effort, level.label.toLowerCase()])) {
          items.push({
            key: `effort-${level.effort}`,
            category: "Effort",
            title: level.label,
            description: level.description,
            hint: currentReasoningEffort === level.effort ? "Current" : undefined,
            actionHint: "Enter",
            accent: currentReasoningEffort === level.effort,
            onSelect: () => applySlashAction(() => setReasoningEffort(level.effort)),
          });
        }
      }
      return items;
    }

    return [];
  })();

  const selectedMentionItem =
    (selectedMentionKey
      ? mentionEntries.find((entry) => mentionEntryKey(entry) === selectedMentionKey)
      : null) ??
    mentionEntries[0] ??
    null;
  const selectedSlashItem =
    (selectedSlashKey ? slashMenuItems.find((item) => item.key === selectedSlashKey) : null) ??
    slashMenuItems[0] ??
    null;
  const isMentionMenuOpen = !!mentionTrigger;
  const isSlashMenuOpen = !!slashContext && slashMenuItems.length > 0;

  useEffect(() => {
    if (slashMenuItems.length === 0) {
      setSelectedSlashKey(null);
      return;
    }

    setSelectedSlashKey((prev) => {
      if (prev && slashMenuItems.some((item) => item.key === prev)) return prev;
      return slashMenuItems[0]?.key ?? null;
    });
  }, [setSelectedSlashKey, slashContext?.argQuery, slashContext?.hasArgument, slashMenuItems]);

  useEffect(() => {
    if (!selectedMentionKey) return;
    const list = mentionListRef.current;
    if (!list) return;

    const frame = requestAnimationFrame(() => {
      const item = list.querySelector<HTMLElement>(
        `[data-menu-item-id="${CSS.escape(selectedMentionKey)}"]`,
      );
      item?.scrollIntoView({ block: "nearest" });
    });

    return () => cancelAnimationFrame(frame);
  }, [mentionListRef, mentionEntries, selectedMentionKey]);

  useEffect(() => {
    if (!selectedSlashKey) return;
    const list = slashListRef.current;
    if (!list) return;

    const frame = requestAnimationFrame(() => {
      const item = list.querySelector<HTMLElement>(
        `[data-menu-item-id="${CSS.escape(selectedSlashKey)}"]`,
      );
      item?.scrollIntoView({ block: "nearest" });
    });

    return () => cancelAnimationFrame(frame);
  }, [selectedSlashKey, slashListRef, slashMenuItems]);

  useEffect(() => {
    if (!mentionTrigger && !isSlashMenuOpen) return;

    const handleWindowKeyDown = (event: KeyboardEvent) => {
      const composerContainer = composerContainerRef.current;
      const target = event.target;
      const isInsideComposer =
        composerContainer && target instanceof Node && composerContainer.contains(target);

      // Escape always dismisses regardless of focus location
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();

        if (mentionTrigger) {
          setMentionEntries([]);
          setSelectedMentionKey(null);
          dismissMentionMenu();
          return;
        }

        setSelectedSlashKey(null);
        dismissSlashMenu();
        return;
      }

      // Tab/Enter only apply when focus is inside the composer
      if (!isInsideComposer) return;

      if (mentionTrigger && (event.key === "Tab" || event.key === "Enter")) {
        event.preventDefault();
        event.stopPropagation();
        if (selectedMentionItem) {
          applyMentionEntry(selectedMentionItem);
        }
        return;
      }

      if (isSlashMenuOpen && (event.key === "Tab" || event.key === "Enter")) {
        event.preventDefault();
        event.stopPropagation();
        selectedSlashItem?.onSelect();
        return;
      }
    };

    // Click outside composer + menu dismisses the menu
    const handleWindowMouseDown = (event: MouseEvent) => {
      const composerContainer = composerContainerRef.current;
      const target = event.target;
      if (!(target instanceof Node)) return;

      // Click inside the composer container (which includes the menu overlay) — keep open
      if (composerContainer?.contains(target)) return;

      // Click inside the mention list (it's positioned absolutely, may be outside composer)
      const mentionList = mentionListRef.current;
      if (mentionList?.contains(target)) return;

      if (mentionTrigger) {
        setMentionEntries([]);
        setSelectedMentionKey(null);
        dismissMentionMenu();
      } else if (isSlashMenuOpen) {
        setSelectedSlashKey(null);
        dismissSlashMenu();
      }
    };

    window.addEventListener("keydown", handleWindowKeyDown, true);
    window.addEventListener("mousedown", handleWindowMouseDown, true);
    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown, true);
      window.removeEventListener("mousedown", handleWindowMouseDown, true);
    };
  }, [
    composerContainerRef,
    mentionListRef,
    dismissMentionMenu,
    dismissSlashMenu,
    isSlashMenuOpen,
    mentionTrigger,
    selectedMentionItem,
    selectedSlashItem,
    setMentionEntries,
    setSelectedMentionKey,
    setSelectedSlashKey,
  ]);

  const handleComposerKeyDown = (event: ReactKeyboardEvent) => {
    if (isMentionMenuOpen) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        const selectedKey = selectedMentionItem ? mentionEntryKey(selectedMentionItem) : null;
        const currentIndex = selectedKey
          ? mentionEntries.findIndex((entry) => mentionEntryKey(entry) === selectedKey)
          : -1;
        const nextIndex = getNextIndex(currentIndex, mentionEntries.length, "next");
        const next = mentionEntries[nextIndex];
        setSelectedMentionKey(next ? mentionEntryKey(next) : null);
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        const selectedKey = selectedMentionItem ? mentionEntryKey(selectedMentionItem) : null;
        const currentIndex = selectedKey
          ? mentionEntries.findIndex((entry) => mentionEntryKey(entry) === selectedKey)
          : -1;
        const nextIndex = getNextIndex(currentIndex, mentionEntries.length, "prev");
        const next = mentionEntries[nextIndex];
        setSelectedMentionKey(next ? mentionEntryKey(next) : null);
        return;
      }

      if (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey)) {
        event.preventDefault();
        if (selectedMentionItem) {
          applyMentionEntry(selectedMentionItem);
        }
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        setMentionEntries([]);
        setSelectedMentionKey(null);
        dismissMentionMenu();
        return;
      }
    }

    if (isSlashMenuOpen) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        const currentIndex = selectedSlashItem
          ? slashMenuItems.findIndex((item) => item.key === selectedSlashItem.key)
          : -1;
        const nextIndex = getNextIndex(currentIndex, slashMenuItems.length, "next");
        setSelectedSlashKey(slashMenuItems[nextIndex]?.key ?? null);
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        const currentIndex = selectedSlashItem
          ? slashMenuItems.findIndex((item) => item.key === selectedSlashItem.key)
          : -1;
        const nextIndex = getNextIndex(currentIndex, slashMenuItems.length, "prev");
        setSelectedSlashKey(slashMenuItems[nextIndex]?.key ?? null);
        return;
      }

      if (event.key === "Tab") {
        event.preventDefault();
        selectedSlashItem?.onSelect();
        return;
      }

      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        selectedSlashItem?.onSelect();
        return;
      }
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSend();
    }

    if (event.key === "Escape") {
      if (mentionTrigger) {
        event.preventDefault();
        setMentionEntries([]);
        setSelectedMentionKey(null);
        dismissMentionMenu();
        return;
      }

      if (isSlashMenuOpen) {
        event.preventDefault();
        setSelectedSlashKey(null);
        dismissSlashMenu();
        return;
      }

      onCancel();
    }
  };

  const slashGroups = groupSlashMenuItems(slashMenuItems);
  const composerMenu = mentionTrigger ? (
    <MentionMenu
      isMobile={isMobile}
      mentionEntries={mentionEntries}
      loading={mentionLoading}
      selectedMentionKey={selectedMentionKey}
      onSelectMentionKey={setSelectedMentionKey}
      onApplyMentionEntry={applyMentionEntry}
      mentionListRef={mentionListRef}
    />
  ) : isSlashMenuOpen ? (
    <SlashMenu
      isMobile={isMobile}
      slashGroups={slashGroups}
      selectedSlashKey={selectedSlashKey}
      onSelectSlashKey={setSelectedSlashKey}
      slashListRef={slashListRef}
    />
  ) : null;

  return {
    composerMenu,
    handleComposerKeyDown,
  };
}
