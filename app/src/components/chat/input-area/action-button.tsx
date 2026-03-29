import { forwardRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ArrowUp, Square } from "lucide-react";
import { Tooltip } from "../../ui/tooltip";

const ease = [0.4, 0, 0.2, 1] as const;

interface ActionButtonProps {
  /** True when the agent is processing — renders as a Stop button. */
  isStop: boolean;
  onClick: () => void;
  onStopClick: () => void;
  disabled: boolean;
  label?: string;
  tooltip?: string;
  stopTooltip?: string;
  /** Visual variant for the send state. "queue" renders a dimmed, dashed-border style. */
  variant?: "default" | "queue";
}

/**
 * A single button that morphs between Send and Stop states.
 *
 * - **Send** (default): accent background, ArrowUp icon (or label text).
 * - **Stop**: solid error background, white filled Square icon.
 *
 * The background colour transitions via CSS while the icon crossfades
 * with a scale + rotate animation for a smooth "morph" feel.
 * A slight delay on the send→stop transition makes the change more noticeable.
 */
export const ActionButton = forwardRef<HTMLButtonElement, ActionButtonProps>(function ActionButton(
  { isStop, onClick, onStopClick, disabled, label, tooltip, stopTooltip, variant = "default" },
  ref,
) {
  const hasLabel = !!label && !isStop;
  const isQueue = variant === "queue" && !isStop;

  return (
    <Tooltip content={isStop ? stopTooltip : tooltip}>
      <motion.button
        ref={ref}
        layout="size"
        onClick={isStop ? onStopClick : onClick}
        disabled={!isStop && disabled}
        className={`
            relative inline-flex items-center justify-center overflow-hidden
            font-semibold
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40
            focus-visible:ring-offset-1 focus-visible:ring-offset-bg
            disabled:cursor-not-allowed disabled:opacity-40
            ${
              isStop
                ? "bg-error text-white hover:bg-error/90"
                : isQueue
                  ? "border border-dashed border-accent/60 bg-accent/15 text-accent shadow-none hover:bg-accent/25"
                  : "bg-accent text-white shadow-sm hover:bg-accent-hover hover:shadow-md"
            }
            ${hasLabel ? "h-9 rounded-full px-4 text-[0.875rem] tracking-[-0.02em]" : "h-8 w-8 rounded-full p-0"}
          `}
        style={{ minWidth: hasLabel ? undefined : 32 }}
        animate={{
          backgroundColor: undefined, // let CSS handle color
        }}
        transition={{ layout: { duration: 0.2, ease } }}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          {label && !isStop ? (
            <motion.span
              key="label"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease }}
            >
              {label}
            </motion.span>
          ) : isStop ? (
            <motion.span
              key="stop"
              className="flex items-center justify-center"
              initial={{ opacity: 0, scale: 0.3, rotate: -90 }}
              animate={{ opacity: 1, scale: 1, rotate: 0 }}
              exit={{ opacity: 0, scale: 0.3, rotate: 90 }}
              transition={{ duration: 0.4, ease, delay: 0.15 }}
            >
              <Square size={15} fill="currentColor" strokeWidth={0} />
            </motion.span>
          ) : (
            <motion.span
              key="send"
              className="flex items-center justify-center"
              initial={{ opacity: 0, scale: 0.3, rotate: 90 }}
              animate={{ opacity: 1, scale: 1, rotate: 0 }}
              exit={{ opacity: 0, scale: 0.3, rotate: -90 }}
              transition={{ duration: 0.3, ease }}
            >
              <ArrowUp size={18} strokeWidth={2.5} />
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>
    </Tooltip>
  );
});
