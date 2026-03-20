import { Toolbox } from "lucide-react";
import { getProviderDisplayName } from "@shared/provider-catalog";
import { EmptyState } from "../components/empty-state";
import { useProjectContext } from "../context/project-context";
import { Badge } from "../components/ui/badge";

const sourceLabel: Record<string, string> = {
  project: "Project",
  user: "Global",
  system: "System",
};

export function SkillsPage() {
  const { artifacts } = useProjectContext();
  const skills = artifacts.skills;

  if (skills.length === 0) {
    return (
      <EmptyState
        icon={<Toolbox size={24} strokeWidth={1.5} />}
        title="No skills installed"
        description="Skills extend what agents can do — install them via your provider's skill directory"
      />
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl px-6 py-5">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {skills.map((skill) => (
            <div
              key={skill.path}
              className="rounded-lg border border-border bg-surface px-3.5 py-2.5"
            >
              <div className="flex items-center gap-2">
                <span className="text-[0.8125rem] font-medium text-text-bright">/{skill.name}</span>
                <Badge variant={skill.source === "project" ? "accent" : "default"}>
                  {sourceLabel[skill.source] ?? skill.source}
                </Badge>
              </div>
              {skill.description && (
                <p className="mt-1 line-clamp-2 text-[0.6875rem] leading-relaxed text-muted">
                  {skill.description}
                </p>
              )}
              <div className="mt-1.5 flex items-center gap-1">
                {skill.providers.map((p) => (
                  <Badge key={p} variant="default" className="!px-1.5 !py-0.5 !text-[0.625rem]">
                    {getProviderDisplayName(p)}
                  </Badge>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
