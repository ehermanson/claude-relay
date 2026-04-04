import { useState } from "react";
import { Copy, Check, Send } from "lucide-react";
import { Menu } from "@/components/ui/menu";
import { useMessageRelay } from "@/components/chat/message-relay-context";
import { toast } from "sonner";

type ToolbarPosition = "top" | "bottom";

interface MessageHoverToolbarProps {
  text: string;
  visible: boolean;
  position?: ToolbarPosition;
}

export function MessageHoverToolbar({ text, visible, position = "top" }: MessageHoverToolbarProps) {
  const relay = useMessageRelay();
  const [copied, setCopied] = useState(false);

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

  const positionClasses =
    position === "top" ? "absolute -top-3 right-2 z-10" : "absolute bottom-3 right-2 z-10";

  const menuSide = position === "top" ? "bottom" : "top";

  return (
    <div
      className={`${positionClasses} flex items-center gap-0.5 rounded-md border border-border bg-surface px-0.5 py-0.5 shadow-sm`}
    >
      <button
        onClick={handleCopy}
        className="rounded p-1 text-muted transition-colors hover:bg-surface-hover hover:text-text"
        title="Copy"
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </button>

      {relay && (
        <Menu.Root>
          <Menu.Trigger className="rounded p-1 text-muted transition-colors hover:bg-surface-hover hover:text-text">
            <Send size={12} />
          </Menu.Trigger>
          <Menu.Content side={menuSide} align="end">
            {hasSiblings ? (
              <>
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
              </>
            ) : null}
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
    </div>
  );
}
