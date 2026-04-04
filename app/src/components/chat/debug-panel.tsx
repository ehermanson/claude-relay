import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Button } from "../ui/button";
import { Tabs } from "../ui/tabs";
import type { HistoryEntry, InstanceInfo, ProviderGlobalState } from "@shared/types";
import type { ChatItem } from "../../hooks/use-instance-messages";

const SESSION_EVENT_TYPES = new Set([
  "session_init",
  "provider_status",
  "provider_notice",
  "model_rerouted",
]);

/**
 * Tracks whether a scrollable element is near the top or bottom and exposes
 * scroll-to helpers. Returns a ref to attach to the scrollable element.
 */
function useScrollJump(threshold = 80) {
  const ref = useRef<HTMLPreElement>(null);
  const [nearTop, setNearTop] = useState(true);
  const [nearBottom, setNearBottom] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      setNearTop(el.scrollTop <= threshold);
      setNearBottom(el.scrollHeight - el.scrollTop - el.clientHeight <= threshold);
    };
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [threshold]);

  const scrollToTop = () => ref.current?.scrollTo({ top: 0, behavior: "smooth" });
  const scrollToBottom = () =>
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" });

  return { ref, nearTop, nearBottom, scrollToTop, scrollToBottom };
}

export function DebugPanel({
  content,
  onCopy,
  copied,
}: {
  content: string;
  onCopy: () => void;
  copied: boolean;
}) {
  const { ref, nearTop, nearBottom, scrollToTop, scrollToBottom } = useScrollJump();

  return (
    <div className="relative">
      <pre
        ref={ref}
        className="flex-1 overflow-auto rounded-lg border border-border bg-bg p-3.5 font-mono text-[0.75rem] leading-relaxed text-text"
        style={{ maxHeight: "55vh" }}
      >
        {content}
      </pre>

      {/* Scroll jump button — shows ↓ when near top, ↑ when near bottom */}
      {!nearTop && (
        <Button
          variant="icon"
          size="icon-md"
          onClick={nearBottom ? scrollToTop : scrollToBottom}
          className="absolute right-3 bottom-14 border border-border bg-bg shadow-sm"
          title={nearBottom ? "Scroll to top" : "Scroll to bottom"}
        >
          {nearBottom ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
        </Button>
      )}

      <div className="mt-3 flex justify-end">
        <Button
          variant="primary"
          onClick={onCopy}
          className={copied ? "bg-accent/15 text-accent hover:bg-accent/25" : ""}
        >
          {copied ? "Copied!" : "Copy to Clipboard"}
        </Button>
      </div>
    </div>
  );
}

/**
 * Reusable tabbed debug view for a chat instance — shows Raw History,
 * Processed Items, and Instance tabs with copy-to-clipboard support.
 */
export function ChatDebugTabs({
  instance,
  items,
  rawHistory,
  isProcessing,
  providerGlobalState,
}: {
  instance: InstanceInfo;
  items: ChatItem[];
  rawHistory: HistoryEntry[] | null;
  isProcessing: boolean;
  providerGlobalState?: ProviderGlobalState;
}) {
  const [copied, setCopied] = useState(false);

  const dumps = useMemo(() => {
    const sessionEvents = (rawHistory ?? [])
      .filter(
        (entry) =>
          entry.message.type === "system_event" &&
          SESSION_EVENT_TYPES.has((entry.message as { event?: string }).event ?? ""),
      )
      .map((entry) => entry.message);

    return {
      raw: JSON.stringify(rawHistory ?? [], null, 2),
      processed: JSON.stringify({ items, isProcessing }, null, 2),
      provider: JSON.stringify(
        {
          provider: instance.provider,
          preferredModel: instance.preferredModel ?? null,
          activeModel: instance.stats?.model ?? null,
          providerGlobalState: providerGlobalState ?? null,
          providerInstanceState: instance.providerStatus ?? null,
        },
        null,
        2,
      ),
      session: JSON.stringify(sessionEvents, null, 2),
      instance: JSON.stringify(instance, null, 2),
    };
  }, [rawHistory, items, isProcessing, instance, providerGlobalState]);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <Tabs.Root defaultValue="provider" onValueChange={() => setCopied(false)}>
      <Tabs.List className="mb-2">
        <Tabs.Tab value="provider">Provider State</Tabs.Tab>
        <Tabs.Tab value="session">Session Events</Tabs.Tab>
        <Tabs.Tab value="raw">Raw History{rawHistory ? ` (${rawHistory.length})` : ""}</Tabs.Tab>
        <Tabs.Tab value="processed">Processed Items ({items.length})</Tabs.Tab>
        <Tabs.Tab value="instance">Instance</Tabs.Tab>
      </Tabs.List>

      {(["provider", "session", "raw", "processed", "instance"] as const).map((key) => (
        <Tabs.Panel key={key} value={key}>
          <DebugPanel content={dumps[key]} onCopy={() => handleCopy(dumps[key])} copied={copied} />
        </Tabs.Panel>
      ))}
    </Tabs.Root>
  );
}
