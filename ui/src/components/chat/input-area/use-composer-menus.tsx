import { useEffect, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import type { SkillInfo } from "@shared/types";
import { fetchWorkspaceEntries } from "../../../lib/api";
import { detectMentionTrigger, replacePromptRange } from "../../../lib/composer-mentions";
import { MentionMenu, SlashMenu } from "./overlay-menus";
import {
  REASONING_COMMAND_OPTIONS,
  REASONING_LEVELS,
  SLASH_COMMANDS,
  getSlashContext,
  matchesQuery,
  type MentionEntry,
  type SlashMenuItem,
} from "./shared";

interface ModelOption {
  value: string | null;
  label: string;
  commandValue: string;
}

interface UseComposerMenusParams {
  instanceId: string;
  isMobile: boolean;
  skills?: SkillInfo[];
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
  reasoningLabel: string;
  supportsModelSelection: boolean;
  supportsReasoningSelection: boolean;
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
  onCancel: () => void;
  onSend: () => void;
}

function getNextIndex(currentIndex: number, length: number, direction: "next" | "prev") {
  if (length === 0) return -1;
  if (direction === "next") {
    return currentIndex < 0 ? 0 : (currentIndex + 1) % length;
  }
  return currentIndex < 0 ? length - 1 : (currentIndex - 1 + length) % length;
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

export function useComposerMenus({
  instanceId,
  isMobile,
  skills,
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
  reasoningLabel,
  supportsModelSelection,
  supportsReasoningSelection,
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
  onCancel,
  onSend,
}: UseComposerMenusParams) {
  const mentionTrigger = !mentionMenuDismissed
    ? detectMentionTrigger(draftText, composerSelectionOffset)
    : null;

  useEffect(() => {
    if (!mentionTrigger) {
      setMentionEntries([]);
      setSelectedMentionKey(null);
      return;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(async () => {
      const result = await fetchWorkspaceEntries(instanceId, mentionTrigger.query);
      if (cancelled) return;

      setMentionEntries(result.entries);
      setSelectedMentionKey((prev) => {
        if (prev && result.entries.some((entry) => entry.path === prev)) {
          return prev;
        }
        return result.entries[0]?.path ?? null;
      });
    }, 120);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [
    instanceId,
    mentionTrigger?.query,
    mentionTrigger?.rangeEnd,
    mentionTrigger?.rangeStart,
    setMentionEntries,
    setSelectedMentionKey,
  ]);

  const applyMentionEntry = (entry: MentionEntry) => {
    if (!mentionTrigger) return;

    const next = replacePromptRange(
      draftText,
      mentionTrigger.rangeStart,
      mentionTrigger.rangeEnd,
      `@${entry.path} `,
    );
    setComposerValue(next.value, next.cursor);
    setMentionEntries([]);
    setSelectedMentionKey(null);
    resetMentionMenu();
  };

  const rawSlashContext = !slashMenuDismissed ? getSlashContext(draftText) : null;
  // Suppress the menu when the user is typing arguments after a skill name
  const slashContext =
    rawSlashContext?.hasArgument && skills?.some((s) => s.name === rawSlashContext.commandQuery)
      ? null
      : rawSlashContext;

  const slashMenuItems: SlashMenuItem[] = (() => {
    if (!slashContext) return [];

    if (!slashContext.hasArgument) {
      const commandItems: SlashMenuItem[] = SLASH_COMMANDS.filter((command) => {
        if (command.id === "model" && !supportsModelSelection) return false;
        if (command.id === "reasoning" && !supportsReasoningSelection) {
          return false;
        }
        return matchesQuery(slashContext.commandQuery, [command.id, command.title.slice(1)]);
      }).map((command) => ({
        key: command.id,
        category: command.category,
        title: command.title,
        description: command.description,
        hint: command.id === "model" ? modelLabel : reasoningLabel,
        actionHint: "Tab",
        onSelect: () => setComposerValue(`${command.title} `),
      }));

      const skillItems: SlashMenuItem[] = (skills ?? [])
        .filter((skill) => matchesQuery(slashContext.commandQuery, [skill.name]))
        .map((skill) => ({
          key: `skill-${skill.name}`,
          category: "Skill",
          title: `/${skill.name}`,
          description:
            skill.description.length > 80
              ? skill.description.slice(0, 77) + "..."
              : skill.description,
          actionHint: "Enter",
          onSelect: () => setComposerValue(`/${skill.name} `),
        }));

      return [...commandItems, ...skillItems];
    }

    if (slashContext.commandQuery === "model" && supportsModelSelection) {
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

    if (slashContext.commandQuery === "reasoning" && supportsReasoningSelection) {
      return REASONING_COMMAND_OPTIONS.filter((option) =>
        matchesQuery(slashContext.argQuery, [option.commandValue, option.label.toLowerCase()]),
      ).map((option) => ({
        key: `reasoning-${option.commandValue}`,
        category: "Reasoning",
        title: option.label,
        description: option.value
          ? (REASONING_LEVELS.find((level) => level.budget === option.value)?.description ??
            "Custom reasoning effort")
          : "Uses the model default reasoning effort",
        hint: reasoningBudget === option.value ? "Current" : undefined,
        actionHint: "Enter",
        accent: reasoningBudget === option.value,
        onSelect: () => applySlashAction(() => setReasoningBudget(option.value)),
      }));
    }

    return [];
  })();

  const selectedMentionItem =
    (selectedMentionKey
      ? mentionEntries.find((entry) => entry.path === selectedMentionKey)
      : null) ??
    mentionEntries[0] ??
    null;
  const selectedSlashItem =
    (selectedSlashKey ? slashMenuItems.find((item) => item.key === selectedSlashKey) : null) ??
    slashMenuItems[0] ??
    null;
  const isMentionMenuOpen = !!mentionTrigger;
  const isSlashMenuOpen = !!slashContext;

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
    if (!mentionTrigger && !slashContext) return;

    const handleWindowKeyDown = (event: KeyboardEvent) => {
      const composerContainer = composerContainerRef.current;
      const target = event.target;
      if (composerContainer && target instanceof Node && !composerContainer.contains(target)) {
        return;
      }

      if (mentionTrigger && (event.key === "Tab" || event.key === "Enter")) {
        event.preventDefault();
        event.stopPropagation();
        if (selectedMentionItem) {
          applyMentionEntry(selectedMentionItem);
        }
        return;
      }

      if (slashContext && (event.key === "Tab" || event.key === "Enter")) {
        event.preventDefault();
        event.stopPropagation();
        selectedSlashItem?.onSelect();
        return;
      }

      if (event.key !== "Escape") return;
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
    };

    window.addEventListener("keydown", handleWindowKeyDown, true);
    return () => window.removeEventListener("keydown", handleWindowKeyDown, true);
  }, [
    composerContainerRef,
    dismissMentionMenu,
    dismissSlashMenu,
    mentionTrigger,
    selectedMentionItem,
    selectedSlashItem,
    setMentionEntries,
    setSelectedMentionKey,
    setSelectedSlashKey,
    slashContext,
  ]);

  const handleComposerKeyDown = (event: ReactKeyboardEvent) => {
    if (isMentionMenuOpen) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        const currentIndex = selectedMentionItem
          ? mentionEntries.findIndex((entry) => entry.path === selectedMentionItem.path)
          : -1;
        const nextIndex = getNextIndex(currentIndex, mentionEntries.length, "next");
        setSelectedMentionKey(mentionEntries[nextIndex]?.path ?? null);
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        const currentIndex = selectedMentionItem
          ? mentionEntries.findIndex((entry) => entry.path === selectedMentionItem.path)
          : -1;
        const nextIndex = getNextIndex(currentIndex, mentionEntries.length, "prev");
        setSelectedMentionKey(mentionEntries[nextIndex]?.path ?? null);
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
      selectedMentionKey={selectedMentionKey}
      onSelectMentionKey={setSelectedMentionKey}
      onApplyMentionEntry={applyMentionEntry}
      mentionListRef={mentionListRef}
    />
  ) : slashContext ? (
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
