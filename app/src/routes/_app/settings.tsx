import { createFileRoute, Outlet, Link, redirect, useLocation } from "@tanstack/react-router";
import { Settings2, Cpu, GitBranch } from "lucide-react";

const NAV_ITEMS = [
  { to: "/settings/general", label: "General", icon: Settings2 },
  { to: "/settings/providers", label: "Providers", icon: Cpu },
  { to: "/settings/git", label: "Git", icon: GitBranch },
] as const;

function SettingsLayout() {
  const location = useLocation();

  return (
    <div className="flex h-full flex-1 overflow-hidden">
      {/* ── Left nav ─────────────────────────────────────────────── */}
      <nav className="w-44 shrink-0 overflow-y-auto border-r border-border px-3 py-6">
        <h1 className="mb-5 px-2 text-lg font-bold text-text-bright">Settings</h1>
        <ul className="space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = location.pathname === item.to;
            return (
              <li key={item.to}>
                <Link
                  to={item.to}
                  className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-[0.8125rem] font-medium transition-colors ${
                    active
                      ? "bg-accent/10 text-accent"
                      : "text-muted hover:bg-surface-hover hover:text-text"
                  }`}
                >
                  <Icon size={15} />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* ── Content ──────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-8 py-6">
          <Outlet />
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/_app/settings")({
  component: SettingsLayout,
  beforeLoad: ({ location }) => {
    if (location.pathname === "/settings" || location.pathname === "/settings/") {
      throw redirect({ to: "/settings/general" });
    }
  },
});
