import { createContext, useContext } from "react";
import type { ProjectArtifacts } from "@shared/types";

interface ProjectContextValue {
  artifacts: ProjectArtifacts | null;
  loading: boolean;
  error: string | null;
}

export const ProjectContext = createContext<ProjectContextValue>({
  artifacts: null,
  loading: true,
  error: null,
});

export function useProjectContext() {
  return useContext(ProjectContext);
}
