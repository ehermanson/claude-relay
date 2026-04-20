/**
 * Suggestion settings — used in both global and project settings pages.
 *
 * Shows the resolved suggestion list with disable toggles, and allows
 * adding/editing/removing custom suggestions. Cap at 8 total.
 */

import { useCallback, useState, useRef, useEffect } from "react";
import { Plus, Pencil, Trash2, X, Check } from "lucide-react";
import { SettingsSection } from "@/components/settings/settings-shared";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { Popover } from "@/components/ui/popover";
import { getSuggestionIcon, SUGGESTION_ICON_NAMES } from "@/lib/suggestion-icons";
import { BUILT_IN_SUGGESTIONS, MAX_SUGGESTIONS, resolveSuggestions } from "@shared/actions";
import type { SuggestionsConfig, CustomSuggestion, SuggestionIcon } from "@shared/types";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";

// ─── Helpers ────────────────────────────────────────────────────────────────

function generateId(): string {
  return Math.random().toString(16).slice(2, 10);
}

const EMPTY_CONFIG: SuggestionsConfig = { patches: {}, custom: [] };

function mergeConfig(base: SuggestionsConfig | null | undefined): SuggestionsConfig {
  return base
    ? { patches: { ...base.patches }, custom: [...base.custom] }
    : { ...EMPTY_CONFIG, patches: {}, custom: [] };
}

function isGlobalBuiltInDisabled(
  globalConfig: SuggestionsConfig | null | undefined,
  id: string,
): boolean {
  return !!globalConfig?.patches[id]?.disabled;
}

function getInheritedCustomSuggestions(
  globalConfig: SuggestionsConfig | null | undefined,
  current: SuggestionsConfig,
): CustomSuggestion[] {
  const globalCustom = globalConfig?.custom ?? [];
  return globalCustom
    .filter((suggestion) => {
      if (suggestion.disabled) return false;
      if (current.custom.some((custom) => custom.id === suggestion.id)) return false;
      return true;
    })
    .map((suggestion) => ({
      ...suggestion,
      disabled: !!current.patches[suggestion.id]?.disabled,
    }));
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface SuggestionSettingsProps {
  /** Current config at this level (global or project). */
  config: SuggestionsConfig | null | undefined;
  /** Called when config changes. */
  onChange: (config: SuggestionsConfig) => void;
  /** Title for the section. */
  title?: string;
  /** Description for the section. */
  description?: string;
  /** Global config — only relevant for project-level settings (to resolve total count). */
  globalConfig?: SuggestionsConfig | null;
}

// ─── Main component ─────────────────────────────────────────────────────────

export function SuggestionSettings({
  config,
  onChange,
  title = "Suggestions",
  description = "Customize the prompt suggestions shown on new chats.",
  globalConfig,
}: SuggestionSettingsProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const current = mergeConfig(config);
  const isProjectLevel = !!globalConfig;
  const inheritedCustomSuggestions = getInheritedCustomSuggestions(globalConfig, current);

  const resolvedSuggestions = resolveSuggestions(globalConfig, current);
  const enabledInheritedCustomCount = inheritedCustomSuggestions.filter((s) => !s.disabled).length;
  const enabledCustomCount = current.custom.filter((s) => !s.disabled).length;
  const totalEnabled = resolvedSuggestions.length;
  const canAddMore = totalEnabled < MAX_SUGGESTIONS;

  const toggleBuiltIn = useCallback(
    (id: string) => {
      const next = mergeConfig(config);
      const isCurrentlyDisabled = next.patches[id]?.disabled;
      if (isCurrentlyDisabled) {
        // Re-enable: remove the disabled flag (or remove patch if empty)
        const patch = { ...next.patches[id] };
        delete patch.disabled;
        if (Object.keys(patch).length === 0) {
          delete next.patches[id];
        } else {
          next.patches[id] = patch;
        }
      } else {
        // Disable
        next.patches[id] = { ...next.patches[id], disabled: true };
      }
      onChange(next);
    },
    [config, onChange],
  );

  const toggleInheritedCustom = useCallback(
    (id: string) => {
      const next = mergeConfig(config);
      const isCurrentlyDisabled = next.patches[id]?.disabled;
      if (isCurrentlyDisabled) {
        const patch = { ...next.patches[id] };
        delete patch.disabled;
        if (Object.keys(patch).length === 0) {
          delete next.patches[id];
        } else {
          next.patches[id] = patch;
        }
      } else {
        next.patches[id] = { ...next.patches[id], disabled: true };
      }
      onChange(next);
    },
    [config, onChange],
  );

  const toggleCustom = useCallback(
    (id: string) => {
      const next = mergeConfig(config);
      const idx = next.custom.findIndex((c) => c.id === id);
      if (idx >= 0) {
        next.custom[idx] = {
          ...next.custom[idx],
          disabled: !next.custom[idx].disabled,
        };
        onChange(next);
      }
    },
    [config, onChange],
  );

  const removeCustom = useCallback(
    (id: string) => {
      const next = mergeConfig(config);
      next.custom = next.custom.filter((c) => c.id !== id);
      onChange(next);
    },
    [config, onChange],
  );

  const addCustom = useCallback(() => {
    const next = mergeConfig(config);
    const newSuggestion: CustomSuggestion = {
      id: generateId(),
      label: "New Suggestion",
      description: "Describe what this suggestion does.",
      icon: "Sparkles",
      prompt: "",
    };
    next.custom.push(newSuggestion);
    onChange(next);
    setEditingId(newSuggestion.id);
  }, [config, onChange]);

  const updateCustom = useCallback(
    (id: string, updates: Partial<CustomSuggestion>) => {
      const next = mergeConfig(config);
      const idx = next.custom.findIndex((c) => c.id === id);
      if (idx >= 0) {
        next.custom[idx] = { ...next.custom[idx], ...updates };
        onChange(next);
      }
    },
    [config, onChange],
  );

  return (
    <SettingsSection title={title} description={description}>
      {/* Built-in suggestions */}
      <div className="py-3">
        <div className="mb-2 text-[0.6875rem] font-medium uppercase tracking-wider text-muted/70">
          Built-in
        </div>
        <div className="space-y-1">
          {BUILT_IN_SUGGESTIONS.map((suggestion) => {
            const Icon = getSuggestionIcon(suggestion.icon);
            const globallyDisabled = isGlobalBuiltInDisabled(globalConfig, suggestion.id);
            const disabled = globallyDisabled || !!current.patches[suggestion.id]?.disabled;
            return (
              <div
                key={suggestion.id}
                className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-surface-hover"
              >
                <Icon size={14} className={disabled ? "text-muted/30" : "text-muted/60"} />
                <div className="min-w-0 flex-1">
                  <div
                    className={`text-[0.8125rem] font-medium ${disabled ? "text-muted/40 line-through" : "text-text-bright"}`}
                  >
                    {suggestion.label}
                  </div>
                  <div className="text-[0.6875rem] text-muted/60 truncate">
                    {suggestion.description}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={globallyDisabled}
                  onClick={() => toggleBuiltIn(suggestion.id)}
                  className={`relative h-5 w-9 rounded-full transition-colors ${
                    disabled ? "bg-surface-hover" : "bg-accent"
                  } ${globallyDisabled ? "cursor-not-allowed opacity-50" : ""}`}
                  title={globallyDisabled ? "Disabled globally" : disabled ? "Enable" : "Disable"}
                >
                  <span
                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
                      disabled ? "left-0.5" : "left-[1.125rem]"
                    }`}
                  />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {isProjectLevel && inheritedCustomSuggestions.length > 0 && (
        <div className="py-3">
          <div className="mb-2 text-[0.6875rem] font-medium uppercase tracking-wider text-muted/70">
            Inherited ({enabledInheritedCustomCount})
          </div>
          <div className="space-y-1">
            {inheritedCustomSuggestions.map((suggestion) => (
              <CustomSuggestionRow
                key={suggestion.id}
                suggestion={suggestion}
                onToggle={() => toggleInheritedCustom(suggestion.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Custom suggestions */}
      <div className="py-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[0.6875rem] font-medium uppercase tracking-wider text-muted/70">
            Custom ({enabledCustomCount})
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={addCustom}
            disabled={!canAddMore}
            className="h-6 gap-1 px-2 text-[0.6875rem]"
          >
            <Plus size={12} />
            Add
          </Button>
        </div>

        {current.custom.length === 0 ? (
          <div className="rounded-md border border-dashed border-border/60 px-4 py-6 text-center text-[0.75rem] text-muted/60">
            No custom suggestions yet
          </div>
        ) : (
          <div className="space-y-1">
            {current.custom.map((suggestion) =>
              editingId === suggestion.id ? (
                <CustomSuggestionEditor
                  key={suggestion.id}
                  suggestion={suggestion}
                  onSave={(updates) => {
                    updateCustom(suggestion.id, updates);
                    setEditingId(null);
                  }}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <CustomSuggestionRow
                  key={suggestion.id}
                  suggestion={suggestion}
                  onToggle={() => toggleCustom(suggestion.id)}
                  onEdit={() => setEditingId(suggestion.id)}
                  onRemove={() => setConfirmDeleteId(suggestion.id)}
                />
              ),
            )}
          </div>
        )}

        {!canAddMore && (
          <p className="mt-2 text-[0.6875rem] text-amber-400/80">
            Maximum of {MAX_SUGGESTIONS} resolved suggestions reached.
          </p>
        )}
      </div>
      <ConfirmActionDialog
        open={!!confirmDeleteId}
        onOpenChange={(open) => {
          if (!open) setConfirmDeleteId(null);
        }}
        title="Delete suggestion?"
        description={<>This custom suggestion will be permanently removed.</>}
        confirmLabel="Delete"
        onConfirm={() => {
          if (confirmDeleteId) removeCustom(confirmDeleteId);
          setConfirmDeleteId(null);
        }}
      />
    </SettingsSection>
  );
}

// ─── Custom suggestion row (read mode) ──────────────────────────────────────

function CustomSuggestionRow({
  suggestion,
  onToggle,
  onEdit,
  onRemove,
}: {
  suggestion: CustomSuggestion;
  onToggle: () => void;
  onEdit?: () => void;
  onRemove?: () => void;
}) {
  const Icon = getSuggestionIcon(suggestion.icon);
  const disabled = !!suggestion.disabled;

  return (
    <div className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-surface-hover group">
      <Icon size={14} className={disabled ? "text-muted/30" : "text-muted/60"} />
      <div className="min-w-0 flex-1">
        <div
          className={`text-[0.8125rem] font-medium ${disabled ? "text-muted/40 line-through" : "text-text-bright"}`}
        >
          {suggestion.label}
        </div>
        <div className="text-[0.6875rem] text-muted/60 truncate">{suggestion.description}</div>
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="rounded p-1 text-muted/50 hover:bg-surface-hover hover:text-text"
            title="Edit"
          >
            <Pencil size={12} />
          </button>
        )}
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="rounded p-1 text-muted/50 hover:bg-red-500/20 hover:text-red-400"
            title="Remove"
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={onToggle}
        className={`relative h-5 w-9 rounded-full transition-colors ${
          disabled ? "bg-surface-hover" : "bg-accent"
        }`}
        title={disabled ? "Enable" : "Disable"}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
            disabled ? "left-0.5" : "left-[1.125rem]"
          }`}
        />
      </button>
    </div>
  );
}

// ─── Custom suggestion editor (inline edit mode) ─────────────────────────────

function CustomSuggestionEditor({
  suggestion,
  onSave,
  onCancel,
}: {
  suggestion: CustomSuggestion;
  onSave: (updates: Partial<CustomSuggestion>) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(suggestion.label);
  const [description, setDescription] = useState(suggestion.description);
  const [prompt, setPrompt] = useState(suggestion.prompt);
  const [icon, setIcon] = useState<SuggestionIcon>(suggestion.icon);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const labelRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    labelRef.current?.focus();
  }, []);

  const handleSave = () => {
    if (!label.trim() || !prompt.trim()) return;
    onSave({ label: label.trim(), description: description.trim(), prompt: prompt.trim(), icon });
  };

  const SelectedIcon = getSuggestionIcon(icon);

  return (
    <div className="rounded-lg border border-border bg-surface p-3 space-y-3">
      <div className="flex items-start gap-3">
        {/* Icon picker */}
        <Popover.Root open={iconPickerOpen} onOpenChange={setIconPickerOpen}>
          <Popover.Trigger className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-muted/60 hover:border-border-hover hover:text-text transition-colors">
            <SelectedIcon size={14} />
          </Popover.Trigger>
          <Popover.Content side="bottom" align="start" sideOffset={4} className="!p-2.5">
            <IconPickerGrid
              selected={icon}
              onSelect={(name) => {
                setIcon(name);
                setIconPickerOpen(false);
              }}
            />
          </Popover.Content>
        </Popover.Root>

        <div className="flex-1 space-y-2">
          <Input
            ref={labelRef}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Suggestion label"
            className="h-8 text-[0.8125rem]"
          />
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Short description"
            className="h-8 text-[0.75rem]"
          />
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Prompt text (what gets pre-filled in the composer)"
            className="min-h-[60px] resize-y text-[0.75rem] font-mono"
            rows={3}
          />
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onCancel}
          className="h-7 gap-1 px-2 text-[0.6875rem]"
        >
          <X size={12} />
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={!label.trim() || !prompt.trim()}
          className="h-7 gap-1 px-2 text-[0.6875rem]"
        >
          <Check size={12} />
          Save
        </Button>
      </div>
    </div>
  );
}

// ─── Icon picker grid (rendered inside a Popover) ───────────────────────────

function IconPickerGrid({
  selected,
  onSelect,
}: {
  selected: SuggestionIcon;
  onSelect: (name: SuggestionIcon) => void;
}) {
  return (
    <div className="grid grid-cols-5 gap-1.5">
      {SUGGESTION_ICON_NAMES.map((name) => {
        const Icon = getSuggestionIcon(name);
        return (
          <button
            key={name}
            type="button"
            onClick={() => onSelect(name)}
            className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
              name === selected
                ? "bg-accent/20 text-accent"
                : "text-muted/60 hover:bg-surface-hover hover:text-text"
            }`}
            title={name}
          >
            <Icon size={16} strokeWidth={1.75} />
          </button>
        );
      })}
    </div>
  );
}
