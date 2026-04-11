import { useCallback, useMemo, useRef, useState } from "react";
import { CircleSlash, Toolbox } from "lucide-react";
import { getProviderDisplayName } from "@shared/provider-catalog";
import { EmptyState } from "../components/empty-state";
import { PageShell } from "@/components/ui/page-shell";
import { useProjectContext } from "../context/project-context";
import { Badge } from "../components/ui/badge";
import { useWSState } from "@/context/websocket-context";
import type { ProviderKind, ProviderSkill } from "@shared/types";

interface DisplaySkill {
  name: string;
  description: string;
  source: "project" | "user" | "system";
  path?: string;
  providers: ProviderKind[];
  runtimeByProvider: Partial<Record<ProviderKind, ProviderSkill>>;
}

function SkillDescription({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);
  const [truncated, setTruncated] = useState(false);

  const checkTruncation = useCallback((el: HTMLParagraphElement | null) => {
    (ref as React.MutableRefObject<HTMLParagraphElement | null>).current = el;
    if (el) {
      setTruncated(el.scrollHeight > el.clientHeight);
    }
  }, []);

  if (!text) {
    return null;
  }

  return (
    <div className="mt-1.5">
      <p
        ref={checkTruncation}
        className={`text-[0.6875rem] leading-relaxed text-muted ${expanded ? "" : "line-clamp-2"}`}
      >
        {text}
      </p>
      {truncated && !expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-0.5 text-[0.625rem] text-accent hover:text-accent/80"
        >
          show more
        </button>
      )}
      {expanded && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="mt-0.5 text-[0.625rem] text-accent hover:text-accent/80"
        >
          show less
        </button>
      )}
    </div>
  );
}

export function SkillsPage() {
  const { artifacts } = useProjectContext();
  const { instances } = useWSState();
  const skills = useMemo(() => {
    const map = new Map<string, DisplaySkill>();
    for (const skill of artifacts.skills) {
      map.set(skill.name.toLowerCase(), {
        name: skill.name,
        description: skill.description,
        source: skill.source,
        path: skill.path,
        providers: [...skill.providers],
        runtimeByProvider: {},
      });
    }

    const projectInstances = instances.filter(
      (instance) => instance.projectId === artifacts.projectId,
    );
    for (const instance of projectInstances) {
      for (const skill of instance.providerStatus?.skills ?? []) {
        const key = skill.name.toLowerCase();
        const existing = map.get(key);
        if (existing) {
          if (!existing.providers.includes(instance.provider)) {
            existing.providers.push(instance.provider);
            existing.providers.sort();
          }
          existing.runtimeByProvider[instance.provider] = skill;
          if (!existing.description) {
            existing.description = skill.shortDescription ?? skill.description ?? "";
          }
        } else {
          map.set(key, {
            name: skill.name,
            description: skill.shortDescription ?? skill.description ?? "",
            source: skill.source ?? "system",
            path: skill.path,
            providers: [instance.provider],
            runtimeByProvider: { [instance.provider]: skill },
          });
        }
      }
    }

    const all = [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
    const project = all.filter((s) => s.source === "project");
    const user = all.filter((s) => s.source === "user");
    const system = all.filter((s) => s.source === "system");
    return { project, user, system };
  }, [artifacts.projectId, artifacts.skills, instances]);

  const groups = [
    { key: "project", label: "Project", skills: skills.project },
    { key: "user", label: "Global", skills: skills.user },
    { key: "system", label: "System", skills: skills.system },
  ].filter((g) => g.skills.length > 0);

  if (groups.length === 0) {
    return (
      <PageShell maxWidth="wide">
        <EmptyState
          icon={<Toolbox size={24} strokeWidth={1.5} />}
          title="No skills installed"
          description="Skills extend what agents can do — install them via your provider's skill directory"
        />
      </PageShell>
    );
  }

  let cardIndex = 0;

  return (
    <PageShell maxWidth="wide">
      <div className="space-y-6">
        {groups.map((group) => (
          <section key={group.key}>
            <h2 className="mb-2.5 text-xs font-medium uppercase tracking-wide text-muted">
              {group.label}
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {group.skills.map((skill) => {
                const i = cardIndex++;
                return (
                  <div
                    key={skill.path}
                    className="flex flex-col rounded-lg border border-border bg-surface px-3.5 py-2.5 opacity-0 animate-stagger-fade-in"
                    style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}
                  >
                    {/* Header: skill name */}
                    <div className="flex items-center gap-2">
                      <span className="text-[0.8125rem] font-medium text-text-bright">
                        {skill.name}
                      </span>
                    </div>

                    {/* Description — clamped to 2 lines, expandable */}
                    <SkillDescription text={skill.description} />

                    {/* Footer: provider badges */}
                    <div className="mt-auto flex flex-wrap items-center gap-1 pt-2">
                      {skill.providers.map((provider) => {
                        const runtime = skill.runtimeByProvider[provider];
                        const isDisabled = runtime?.enabled === false;
                        return (
                          <Badge
                            key={`${skill.name}-${provider}`}
                            variant="default"
                            size="xs"
                            dot
                            dotClass={isDisabled ? "bg-muted/50" : "bg-accent"}
                          >
                            {getProviderDisplayName(provider)}
                            {isDisabled && (
                              <CircleSlash size={9} className="ml-0.5 text-muted/60" />
                            )}
                          </Badge>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </PageShell>
  );
}
