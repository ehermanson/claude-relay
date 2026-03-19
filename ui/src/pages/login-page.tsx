import { useState, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RelayLogo } from "@/components/ui/relay-logo";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { useAuthContext } from "@/context/auth-context";

const MotionLogo = motion.create(RelayLogo);

export function LoginPage() {
  const { login } = useAuthContext();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [hovered, setHovered] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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
        navigate({ to: "/", replace: true });
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
    <div className="relative flex min-h-[100dvh] flex-col items-center justify-center bg-bg p-6">
      {/* Ambient glow */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-1/3 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/[0.04] blur-[120px]" />
      </div>
      <ThemeToggle className="absolute right-4 top-4 z-10 h-8 w-8" />
      <div className="relative w-full max-w-[360px]">
        <div className="mb-12 flex flex-col items-center text-center">
          <MotionLogo
            size={160}
            hovered={hovered}
            showPulseRings
            className="mb-6 cursor-pointer"
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: "spring", duration: 1.2, bounce: 0.35 }}
            whileHover={{ scale: 1.08 }}
            onHoverStart={() => setHovered(true)}
            onHoverEnd={() => setHovered(false)}
          />
          <motion.h1
            className="mb-2 text-3xl text-text-bright"
            style={{
              fontFamily: "'Orbitron', sans-serif",
              fontWeight: 900,
              letterSpacing: "0.06em",
            }}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.6, ease: "easeOut" }}
          >
            Relay
          </motion.h1>
          <motion.p
            className="text-sm text-muted"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5, duration: 0.6 }}
          >
            Enter your password to continue
          </motion.p>
        </div>

        <motion.div
          className="glass rounded-xl p-7"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, type: "spring", duration: 0.8, bounce: 0.2 }}
        >
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
              <Input
                ref={inputRef}
                autoFocus
                type="password"
                id="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (error) setError("");
                }}
                placeholder="Enter password"
                autoComplete="current-password"
                className="px-4 py-2.5 text-sm"
              />
            </div>

            <Button
              type="submit"
              variant="primary"
              size="lg"
              disabled={loading}
              className="w-full font-semibold"
            >
              {loading ? "Signing in..." : "Sign In"}
            </Button>
          </form>
        </motion.div>
      </div>
    </div>
  );
}
