import { createRootRoute, Outlet } from "@tanstack/react-router";
import { AuthProvider } from "../context/auth-context";
import { ThemeProvider } from "../context/theme-context";

export const Route = createRootRoute({
  component: () => (
    <ThemeProvider>
      <AuthProvider>
        <Outlet />
      </AuthProvider>
    </ThemeProvider>
  ),
});
