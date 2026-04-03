import { useEffect, useMemo, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/input";
import { DebugPanel } from "@/components/chat/debug-panel";
import { replayHistoryToItems } from "@/hooks/use-instance-messages";
import { fetchInstanceHistory } from "@/lib/api";
import { Tabs } from "@/components/ui/tabs";
import type { HistoryEntry, InstanceInfo, SpaceInfo } from "@shared/types";

export function SpaceDebugModal({
  space,
  instances,
  defaultInstanceId,
  onClose,
}: {
  space: SpaceInfo;
  instances: InstanceInfo[];
  defaultInstanceId?: string;
  onClose: () => void;
}) {
  const [selectedChatId, setSelectedChatId] = useState(defaultInstanceId ?? "");
  const [chatHistory, setChatHistory] = useState<HistoryEntry[] | null>(null);
  const [loadingChat, setLoadingChat] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState("space");

  const selectedInstance = instances.find((i) => i.id === selectedChatId);

  // Fetch history when a chat is selected
  useEffect(() => {
    if (!selectedChatId) {
      setChatHistory(null);
      return;
    }
    let cancelled = false;
    setLoadingChat(true);
    setChatHistory(null);
    fetchInstanceHistory(selectedChatId)
      .then((history) => {
        if (!cancelled) setChatHistory(history);
      })
      .catch(() => {
        if (!cancelled) setChatHistory([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingChat(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedChatId]);

  const spaceDump = useMemo(() => JSON.stringify(space, null, 2), [space]);

  const chatItems = useMemo(
    () => (chatHistory ? replayHistoryToItems(chatHistory) : []),
    [chatHistory],
  );

  const chatDumps = useMemo(() => {
    if (!selectedInstance || !chatHistory) return null;
    return {
      raw: JSON.stringify(chatHistory, null, 2),
      processed: JSON.stringify(
        { items: chatItems, isProcessing: selectedInstance.status === "processing" },
        null,
        2,
      ),
      instance: JSON.stringify(selectedInstance, null, 2),
    };
  }, [chatHistory, chatItems, selectedInstance]);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const hasChatData = selectedChatId && !loadingChat && chatDumps !== null;

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Content maxWidth="max-w-3xl">
        <Dialog.Header>
          <Dialog.Title>Debug — {space.name}</Dialog.Title>
          <Dialog.Close />
        </Dialog.Header>

        {/* Chat selector */}
        {instances.length > 0 && (
          <Select
            value={selectedChatId}
            onChange={(e) => {
              setSelectedChatId(e.target.value);
              setCopied(false);
              // Jump to raw history when a chat is picked
              if (e.target.value) setActiveTab("raw");
              else setActiveTab("space");
            }}
          >
            <option value="">Space only</option>
            {instances.map((inst) => (
              <option key={inst.id} value={inst.id}>
                {inst.name} ({inst.status})
              </option>
            ))}
          </Select>
        )}

        <Tabs.Root
          value={activeTab}
          onValueChange={(v) => {
            setActiveTab(v);
            setCopied(false);
          }}
        >
          <Tabs.List className="mb-2">
            <Tabs.Tab value="space">Space</Tabs.Tab>
            {hasChatData && (
              <>
                <Tabs.Tab value="raw">Raw History ({chatHistory!.length})</Tabs.Tab>
                <Tabs.Tab value="processed">Processed ({chatItems.length})</Tabs.Tab>
                <Tabs.Tab value="instance">Instance</Tabs.Tab>
              </>
            )}
          </Tabs.List>

          <Tabs.Panel value="space">
            <DebugPanel content={spaceDump} onCopy={() => handleCopy(spaceDump)} copied={copied} />
          </Tabs.Panel>

          {hasChatData && (
            <>
              <Tabs.Panel value="raw">
                <DebugPanel
                  content={chatDumps!.raw}
                  onCopy={() => handleCopy(chatDumps!.raw)}
                  copied={copied}
                />
              </Tabs.Panel>
              <Tabs.Panel value="processed">
                <DebugPanel
                  content={chatDumps!.processed}
                  onCopy={() => handleCopy(chatDumps!.processed)}
                  copied={copied}
                />
              </Tabs.Panel>
              <Tabs.Panel value="instance">
                <DebugPanel
                  content={chatDumps!.instance}
                  onCopy={() => handleCopy(chatDumps!.instance)}
                  copied={copied}
                />
              </Tabs.Panel>
            </>
          )}
        </Tabs.Root>

        {selectedChatId && loadingChat && (
          <p className="py-4 text-center text-[0.8125rem] text-muted">Loading chat history…</p>
        )}
      </Dialog.Content>
    </Dialog.Root>
  );
}
