import { createContext, useContext } from "react";
import type { ProjectArtifacts } from "@shared/types";

interface ProjectContextValue {
  artifacts: ProjectArtifacts;
}

export const ProjectContext = createContext<ProjectContextValue | null>(null);

export function useProjectContext() {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error("useProjectContext must be used within ProjectContext.Provider");
  return ctx;
}
