import { useState } from "react";
import { Copy, Check, Send, GitBranchPlus, Reply } from "lucide-react";
import { Menu } from "@/components/ui/menu";
import { useMessageRelay } from "@/components/chat/message-relay-context";
import { toast } from "sonner";

type ToolbarPosition = "top" | "bottom";
type TooltipAlign = "start" | "center" | "end";

interface MessageHoverToolbarProps {
  text: string;
  visible: boolean;
  position?: ToolbarPosition;
  anchorIndex?: number;
}

function ToolbarIconTooltip({
  content,
  visible,
  align = "center",
}: {
  content: string;
  visible: boolean;
  align?: TooltipAlign;
}) {
  if (!visible) return null;

  const alignClasses =
    align === "start"
      ? "left-0 translate-x-0"
      : align === "end"
        ? "right-0 translate-x-0"
        : "left-1/2 -translate-x-1/2";

  return (
    <div
      className={`pointer-events-none absolute bottom-full z-20 mb-2 max-w-[min(18rem,calc(100vw-1rem))] whitespace-nowrap rounded-md border border-border bg-surface px-2 py-1 text-[0.6875rem] leading-none text-text shadow-sm ${alignClasses}`}
    >
      {content}
    </div>
  );
}

export function MessageHoverToolbar({
  text,
  visible,
  position = "top",
  anchorIndex,
}: MessageHoverToolbarProps) {
  const relay = useMessageRelay();
  const [copied, setCopied] = useState(false);
  const [hoveredIcon, setHoveredIcon] = useState<"copy" | "spin-off" | "send" | "source" | null>(
    null,
  );

  if (!visible) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Failed to copy");
    }
  };

  const hasSiblings = relay && relay.siblings.length > 0;
  const showSendMenu = hasSiblings;

  const positionClasses =
    position === "top" ? "absolute -top-4 right-2 z-10" : "absolute bottom-3 right-2 z-10";

  const menuSide = position === "top" ? "bottom" : "top";

  return (
    <div
      className={`${positionClasses} flex items-center gap-0.5 rounded-md border border-border bg-surface px-0.5 py-0.5 shadow-sm`}
    >
      <div className="relative">
        <ToolbarIconTooltip
          content={copied ? "Copied" : "Copy"}
          visible={hoveredIcon === "copy"}
          align="start"
        />
        <button
          onClick={handleCopy}
          onMouseEnter={() => setHoveredIcon("copy")}
          onMouseLeave={() => setHoveredIcon(null)}
          onFocus={() => setHoveredIcon("copy")}
          onBlur={() => setHoveredIcon(null)}
          className="rounded p-1 text-muted transition-colors hover:bg-surface-hover hover:text-text"
          aria-label={copied ? "Copied" : "Copy"}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </button>
      </div>

      {relay && (
        <>
          {relay.allowSpinOff !== false && (
            <div className="relative">
              <ToolbarIconTooltip
                content="Spin off to new chat"
                visible={hoveredIcon === "spin-off"}
                align="center"
              />
              <button
                onClick={() => relay.onSpinOff({ anchorIndex })}
                onMouseEnter={() => setHoveredIcon("spin-off")}
                onMouseLeave={() => setHoveredIcon(null)}
                onFocus={() => setHoveredIcon("spin-off")}
                onBlur={() => setHoveredIcon(null)}
                className="rounded p-1 text-muted transition-colors hover:bg-surface-hover hover:text-text"
                aria-label="Spin off to new chat"
              >
                <GitBranchPlus size={12} />
              </button>
            </div>
          )}

          {relay.sourceChat && relay.onSendToSourceChat && (
            <div className="relative">
              <ToolbarIconTooltip
                content={`Send to ${relay.sourceChat.name}`}
                visible={hoveredIcon === "source"}
                align="end"
              />
              <button
                onClick={() => {
                  relay.onSendToSourceChat?.(text);
                  toast.success(`Sent to "${relay.sourceChat?.name}"`);
                }}
                onMouseEnter={() => setHoveredIcon("source")}
                onMouseLeave={() => setHoveredIcon(null)}
                onFocus={() => setHoveredIcon("source")}
                onBlur={() => setHoveredIcon(null)}
                className="rounded p-1 text-muted transition-colors hover:bg-surface-hover hover:text-text"
                aria-label={`Send to ${relay.sourceChat.name}`}
              >
                <Reply size={12} />
              </button>
            </div>
          )}

          {showSendMenu && (
            <Menu.Root>
              <div className="relative">
                <ToolbarIconTooltip
                  content="Send to chat"
                  visible={hoveredIcon === "send"}
                  align="end"
                />
                <Menu.Trigger
                  onMouseEnter={() => setHoveredIcon("send")}
                  onMouseLeave={() => setHoveredIcon(null)}
                  onFocus={() => setHoveredIcon("send")}
                  onBlur={() => setHoveredIcon(null)}
                  className="rounded p-1 text-muted transition-colors hover:bg-surface-hover hover:text-text"
                  aria-label="Send to chat"
                >
                  <Send size={12} />
                </Menu.Trigger>
              </div>
              <Menu.Content side={menuSide} align="end">
                {relay.siblings.map((sibling) => (
                  <Menu.Item
                    key={sibling.id}
                    onClick={() => {
                      relay.onSendToChat(sibling.id, text);
                      toast.success(`Sent to "${sibling.name}"`);
                    }}
                  >
                    <span className="truncate">{sibling.name}</span>
                    <span className="ml-auto text-[0.6875rem] text-muted">{sibling.status}</span>
                  </Menu.Item>
                ))}
                <Menu.Separator />
                <Menu.Item
                  onClick={() => {
                    relay.onSendToNewChat(text);
                    toast.success("Sent to new chat");
                  }}
                >
                  <span className="text-accent">New chat</span>
                </Menu.Item>
              </Menu.Content>
            </Menu.Root>
          )}
        </>
      )}
    </div>
  );
}
