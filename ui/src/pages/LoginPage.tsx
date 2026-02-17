import { useState, useRef, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuthContext } from "../context/AuthContext";

export function LoginPage() {
  const { login } = useAuthContext();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!password) {
      setError("Please enter a password");
      inputRef.current?.focus();
      return;
    }

    setLoading(true);
    try {
      const result = await login(password);
      if (result.success) {
        navigate({ to: "/chat", replace: true });
      } else {
        setError(result.error || "Authentication failed");
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    } catch {
      setError("Connection failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg p-6">
      <div className="w-full max-w-[360px]">
        <div className="mb-10 text-center">
          <h1 className="mb-2 text-2xl font-semibold tracking-tight text-text-bright">
            Claude Relay
          </h1>
          <p className="text-sm text-muted">Enter your password to continue</p>
        </div>

        <div className="rounded-xl border border-border bg-surface p-7 shadow-sm">
          {error && (
            <div className="mb-5 rounded-lg border border-error/20 bg-error-dim px-4 py-3 text-sm text-error">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="mb-5">
              <label htmlFor="password" className="mb-2 block text-xs font-medium text-muted">
                Password
              </label>
              <input
                ref={inputRef}
                type="password"
                id="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (error) setError("");
                }}
                placeholder="Enter password"
                autoComplete="current-password"
                className="w-full rounded-lg border border-border bg-bg px-4 py-2.5 text-sm text-text transition-all placeholder:text-muted focus:border-accent focus:ring-1 focus:ring-accent-dim focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              {loading ? "Signing in..." : "Sign In"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
