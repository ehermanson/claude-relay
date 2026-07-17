import { describe, expect, it } from "vitest";
import type { ProviderDescriptor } from "@shared/types";
import { getCompatibleMcpProviders, getProjectMcpProviders } from "./mcp-management";

function provider(
  name: "claude" | "codex",
  transports: Array<"http" | "sse" | "stdio">,
  scopes: Array<"global" | "project"> = ["global"],
): ProviderDescriptor {
  return {
    provider: name,
    label: name,
    capabilities: {
      supportsReasoningEffort: false,
      supportsFastMode: false,
      supportsModelSelection: false,
      supportsTitleUpdates: false,
      supportsResume: true,
      supportsTranscriptReplay: true,
      supportsApprovals: true,
      supportsUserInputRequests: true,
      mcp: {
        discovery: "global",
        toolEnumeration: false,
        management: {
          scopes,
          bearerTokenEnvVar: false,
          transports,
        },
      },
    },
  };
}

describe("getCompatibleMcpProviders", () => {
  const providers = [
    provider("claude", ["http", "sse", "stdio"]),
    provider("codex", ["http", "stdio"]),
  ];

  it("offers all installed providers that support the selected transport", () => {
    expect(getCompatibleMcpProviders(providers, "http").map((entry) => entry.provider)).toEqual([
      "claude",
      "codex",
    ]);
  });

  it("excludes providers that do not support the selected transport", () => {
    expect(getCompatibleMcpProviders(providers, "sse").map((entry) => entry.provider)).toEqual([
      "claude",
    ]);
  });
});

describe("getProjectMcpProviders", () => {
  it("exposes installed MCP providers even when their configuration is global", () => {
    const providers = [
      provider("claude", ["http"], ["global", "project"]),
      provider("codex", ["http"]),
    ];
    expect(getProjectMcpProviders(providers).map((entry) => entry.provider)).toEqual([
      "claude",
      "codex",
    ]);
  });
});
