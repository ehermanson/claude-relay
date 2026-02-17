import { useState, useCallback } from "react";
import { login as apiLogin } from "../lib/api";

export function useAuth() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const login = useCallback(async (password: string) => {
    const result = await apiLogin(password);
    if (result.success) {
      setIsAuthenticated(true);
    }
    return result;
  }, []);

  const logout = useCallback(() => {
    setIsAuthenticated(false);
    window.location.href = "/logout";
  }, []);

  return { isAuthenticated, setIsAuthenticated, login, logout };
}
