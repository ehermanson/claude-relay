import type { ProviderSkill, ProviderSlashCommand } from "@shared/types";

function rankMatch(query: string, candidates: string[]): number | null {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return 0;

  let best: number | null = null;
  for (const rawCandidate of candidates) {
    const candidate = rawCandidate.trim().toLowerCase();
    if (!candidate) continue;
    if (candidate === normalizedQuery) best = Math.min(best ?? Number.POSITIVE_INFINITY, 0);
    else if (candidate.startsWith(normalizedQuery))
      best = Math.min(best ?? Number.POSITIVE_INFINITY, 1);
    else if (candidate.includes(normalizedQuery))
      best = Math.min(best ?? Number.POSITIVE_INFINITY, 2 + candidate.indexOf(normalizedQuery));
    else {
      let queryIndex = 0;
      for (let i = 0; i < candidate.length && queryIndex < normalizedQuery.length; i += 1) {
        if (candidate[i] === normalizedQuery[queryIndex]) queryIndex += 1;
      }
      if (queryIndex === normalizedQuery.length) {
        best = Math.min(best ?? Number.POSITIVE_INFINITY, 100 + candidate.length);
      }
    }
  }

  return best;
}

export function searchProviderSkills(skills: ProviderSkill[], query: string): ProviderSkill[] {
  const ranked = skills
    .filter((skill) => skill.enabled ?? true)
    .map((skill) => ({
      skill,
      score: rankMatch(query, [
        skill.name,
        skill.displayName ?? "",
        skill.shortDescription ?? "",
        skill.description ?? "",
        skill.scope ?? "",
      ]),
    }))
    .filter((entry): entry is { skill: ProviderSkill; score: number } => entry.score !== null)
    .sort(
      (a, b) =>
        a.score - b.score ||
        (a.skill.displayName ?? a.skill.name).localeCompare(b.skill.displayName ?? b.skill.name),
    );

  return ranked.map((entry) => entry.skill);
}

export function searchProviderSlashCommands(
  commands: ProviderSlashCommand[],
  query: string,
): ProviderSlashCommand[] {
  const ranked = commands
    .map((command) => ({
      command,
      score: rankMatch(query, [command.name, command.description ?? "", command.input?.hint ?? ""]),
    }))
    .filter(
      (entry): entry is { command: ProviderSlashCommand; score: number } => entry.score !== null,
    )
    .sort((a, b) => a.score - b.score || a.command.name.localeCompare(b.command.name));

  return ranked.map((entry) => entry.command);
}
