import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
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
        navigate("/chat", { replace: true });
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
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg p-4 font-mono">
      <div className="w-full max-w-[340px]">
        <div className="mb-8 text-center">
          <h1 className="mb-2 text-[1.3rem] font-semibold tracking-tight text-text-bright">
            Claude Relay
          </h1>
          <p className="text-[0.6875rem] text-muted">
            Enter your password to continue
          </p>
        </div>

        <div className="rounded-md border border-border bg-surface p-6">
          {error && (
            <div className="mb-4 rounded border border-error/20 bg-error/[0.08] px-3.5 py-2.5 text-xs text-error">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="mb-4">
              <label
                htmlFor="password"
                className="mb-2 block text-[0.625rem] font-medium uppercase tracking-wider text-muted"
              >
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
                className="w-full rounded border border-border bg-bg px-3.5 py-2.5 font-mono text-[0.8125rem] text-text transition-colors placeholder:text-muted focus:border-accent focus:shadow-[0_0_0_1px_var(--color-accent-dim)] focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded border-none bg-accent px-4 py-2.5 font-mono text-xs font-semibold tracking-wide text-bg transition-all hover:bg-accent-hover hover:shadow-[0_0_20px_var(--color-accent-dim)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {loading ? "Signing in..." : "Sign In"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
