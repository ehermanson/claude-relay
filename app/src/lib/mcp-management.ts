import type { ProviderDescriptor } from "@shared/types";

export type McpTransport = "http" | "sse" | "stdio";

export function getCompatibleMcpProviders(
  providers: ProviderDescriptor[],
  transport: McpTransport,
): ProviderDescriptor[] {
  return providers.filter((provider) => {
    const management = provider.capabilities.mcp?.management;
    return management?.transports.includes(transport);
  });
}

export function getProjectMcpProviders(providers: ProviderDescriptor[]): ProviderDescriptor[] {
  return providers.filter((provider) => provider.capabilities.mcp !== undefined);
}
