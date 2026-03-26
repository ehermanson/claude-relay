import { RotateCcw } from "lucide-react";

// ─── Shared layout components ──────────────────────────────────────────────

export function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h2 className="text-base font-semibold text-text-bright">{title}</h2>
      <p className="mt-0.5 text-[0.8125rem] text-muted">{description}</p>
      <div className="mt-5 divide-y divide-dashed divide-border/60">{children}</div>
    </div>
  );
}

export function SettingRow({
  label,
  description,
  children,
  vertical,
  overrideInfo,
}: {
  label: string;
  description: string;
  children: React.ReactNode;
  vertical?: boolean;
  /** When present, shows an override indicator with the global default value */
  overrideInfo?: {
    isOverridden: boolean;
    globalLabel: string;
    onReset: () => void;
  };
}) {
  if (vertical) {
    return (
      <div className="flex flex-col gap-3 py-5">
        <div className="min-w-0">
          <div className="text-[0.8125rem] font-medium text-text-bright">{label}</div>
          <div className="mt-0.5 text-[0.75rem] text-muted">{description}</div>
        </div>
        <div>{children}</div>
        {overrideInfo?.isOverridden && (
          <OverrideIndicator
            globalLabel={overrideInfo.globalLabel}
            onReset={overrideInfo.onReset}
          />
        )}
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between gap-8 py-5">
      <div className="min-w-0">
        <div className="text-[0.8125rem] font-medium text-text-bright">{label}</div>
        <div className="mt-0.5 text-[0.75rem] text-muted">{description}</div>
        {overrideInfo?.isOverridden && (
          <OverrideIndicator
            globalLabel={overrideInfo.globalLabel}
            onReset={overrideInfo.onReset}
          />
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

// ─── Override indicator ─────────────────────────────────────────────────────

function OverrideIndicator({ globalLabel, onReset }: { globalLabel: string; onReset: () => void }) {
  return (
    <div className="mt-1.5 flex items-center gap-2 text-[0.6875rem]">
      <span className="rounded bg-amber-500/10 px-1.5 py-0.5 font-medium text-amber-400">
        Override
      </span>
      <span className="text-muted">
        Global default: <span className="text-text">{globalLabel}</span>
      </span>
      <button
        type="button"
        onClick={onReset}
        className="ml-1 flex items-center gap-1 rounded px-1.5 py-0.5 text-muted transition-colors hover:bg-surface-hover hover:text-text"
        title="Reset to global default"
      >
        <RotateCcw size={10} />
        Reset
      </button>
    </div>
  );
}
