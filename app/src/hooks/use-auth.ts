import { useState } from "react";
import { login as apiLogin, pairWithCode as apiPairWithCode } from "../lib/api";

export function useAuth() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const login = async (password: string) => {
    const result = await apiLogin(password);
    if (result.success) {
      setIsAuthenticated(true);
    }
    return result;
  };

  const pairWithCode = async (code: string) => {
    const result = await apiPairWithCode(code);
    if (result.success) {
      setIsAuthenticated(true);
    }
    return result;
  };

  const logout = () => {
    setIsAuthenticated(false);
    window.location.href = "/logout";
  };

  return { isAuthenticated, setIsAuthenticated, login, pairWithCode, logout };
}
