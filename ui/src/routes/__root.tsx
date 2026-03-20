import { createRootRoute, Outlet } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { AuthProvider } from "../context/auth-context";
import { ThemeProvider } from "../context/theme-context";

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
          {import.meta.env.DEV ? (
            <>
              <TanStackRouterDevtools position="bottom-left" />
              <ReactQueryDevtools buttonPosition="bottom-right" />
            </>
          ) : null}
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  ),
});
