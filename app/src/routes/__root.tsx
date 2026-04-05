import { createRootRoute, Outlet, useRouter } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { AuthProvider } from "../context/auth-context";
import { DevTools } from "../components/dev-tools";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

function RootErrorComponent({ error }: { error: Error }) {
  const router = useRouter();

  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-surface p-8 text-center">
      <AlertTriangle size={32} className="text-warning" />
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-text">Something went wrong</p>
        <p className="max-w-md text-xs text-muted">{error.message}</p>
      </div>
      <button
        type="button"
        onClick={() => router.invalidate()}
        className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent/90"
      >
        <RotateCcw size={12} />
        Try again
      </button>
    </div>
  );
}

export const Route = createRootRoute({
  errorComponent: RootErrorComponent,
  component: () => (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Outlet />
        {import.meta.env.DEV ? <DevTools /> : null}
      </AuthProvider>
    </QueryClientProvider>
  ),
});
