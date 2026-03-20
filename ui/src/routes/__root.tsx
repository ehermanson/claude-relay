import { createRootRoute, Outlet } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "../context/auth-context";
import { ThemeProvider } from "../context/theme-context";
import { DevTools } from "../components/dev-tools";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

export const Route = createRootRoute({
  component: () => (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <Outlet />
          {import.meta.env.DEV ? <DevTools /> : null}
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  ),
});
