import { useState } from "react";
import { Eye, FlaskConical, Play, ScrollText, X, Sparkles } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

export interface SpaceSuggestion {
  id: string;
  label: string;
  description: string;
  icon: typeof Eye;
  prompt: string;
}

export const SPACE_SUGGESTIONS: SpaceSuggestion[] = [
  {
    id: "review-changes",
    label: "Review Changes",
    description: "Check uncommitted work for correctness, edge cases, and style.",
    icon: Eye,
    prompt:
      "Review the uncommitted changes in this workspace. Focus on correctness, edge cases, and style.",
  },
  {
    id: "write-tests",
    label: "Write Tests",
    description: "Generate tests for the uncommitted changes in this workspace.",
    icon: FlaskConical,
    prompt: "Write tests for the uncommitted changes in this workspace.",
  },
  {
    id: "continue-work",
    label: "Continue Work",
    description: "Pick up where the last chat left off using the shared context.",
    icon: Play,
    prompt:
      "Continue working on the space goal. Read the shared context and pick up where the last chat left off.",
  },
  {
    id: "summarize-progress",
    label: "Summarize Progress",
    description: "Recap what's been done so far based on the diff and shared context.",
    icon: ScrollText,
    prompt:
      "Summarize what has been accomplished in this space so far based on the git diff and shared context.",
  },
];

interface SpaceSuggestionCardsProps {
  onSelect: (prompt: string) => void;
}

export function SpaceSuggestionCards({ onSelect }: SpaceSuggestionCardsProps) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="flex w-full flex-col items-end gap-3 px-1"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
      >
        <div className="flex items-center gap-2">
          <Sparkles size={11} className="text-muted/50" />
          <span className="text-[0.6875rem] text-muted/60">Suggestions</span>
          <button
            onClick={() => setDismissed(true)}
            className="ml-0.5 rounded p-0.5 text-muted/40 transition-colors hover:bg-surface-hover hover:text-muted"
          >
            <X size={11} />
          </button>
        </div>

        <div className="grid w-full grid-cols-2 gap-2 mb-4">
          {SPACE_SUGGESTIONS.map((suggestion, i) => (
            <motion.button
              key={suggestion.id}
              onClick={() => onSelect(suggestion.prompt)}
              className="group flex flex-col gap-2 rounded-lg border border-border bg-surface px-3.5 py-3 text-left transition-colors hover:border-border-hover hover:bg-surface-hover"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: i * 0.04 }}
            >
              <suggestion.icon
                size={15}
                strokeWidth={1.75}
                className="text-muted/60 transition-colors group-hover:text-accent"
              />
              <div className="flex flex-col gap-0.5">
                <span className="text-[0.8125rem] font-medium text-text-bright">
                  {suggestion.label}
                </span>
                <span className="text-[0.6875rem] leading-relaxed text-muted">
                  {suggestion.description}
                </span>
              </div>
            </motion.button>
          ))}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
