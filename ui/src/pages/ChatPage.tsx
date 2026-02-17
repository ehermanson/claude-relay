import { Routes, Route, useParams } from "react-router-dom";
import { Sidebar } from "../components/layout/Sidebar";
import { InstanceView } from "../components/chat/InstanceView";
import { useMediaQuery } from "../hooks/useMediaQuery";

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center p-10 text-center text-muted">
      <p className="mb-1 text-[0.8125rem]">
        Select an instance to start chatting
      </p>
      <span className="text-[0.6875rem] opacity-70">
        Or create a new one from the sidebar
      </span>
    </div>
  );
}

function ChatLayout({ hasInstance }: { hasInstance: boolean }) {
  const { id } = useParams<{ id: string }>();
  const isMobile = useMediaQuery("(max-width: 768px)");

  const showSidebar = !isMobile || !hasInstance;
  const showMain = !isMobile || hasInstance;

  return (
    <div className="flex h-full overflow-hidden">
      {showSidebar && <Sidebar />}
      {showMain && (
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {id ? <InstanceView /> : <EmptyState />}
        </main>
      )}
    </div>
  );
}

export function ChatPage() {
  return (
    <Routes>
      <Route path=":id" element={<ChatLayout hasInstance />} />
      <Route path="*" element={<ChatLayout hasInstance={false} />} />
    </Routes>
  );
}
