import { createFileRoute } from "@tanstack/react-router";
import { IssuesPage } from "../../../../../pages/issues-page";

interface IssuesSearch {
  issue?: string;
}

export const Route = createFileRoute("/_app/projects/$projectId/issues/")({
  component: IssuesPage,
  validateSearch: (search: Record<string, unknown>): IssuesSearch => ({
    issue: typeof search.issue === "string" ? search.issue : undefined,
  }),
});
