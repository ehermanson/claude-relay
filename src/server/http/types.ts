import http from "node:http";
import type { Session } from "../../core/types.js";
import type { AuthManager } from "../auth.js";
import type { InstanceManager } from "../../core/instance-manager.js";
import type { RelayConfig } from "../config.js";
import type {
  NativeOpenRequest,
  NativeOpenTargetsResponse,
  ProviderCapabilities,
  ProviderDescriptor,
  ProviderKind,
  ProviderModelOption,
} from "../../core/types.js";

export interface RequestContext {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  method: string;
  parsedUrl: URL;
  pathname: string;
  session: Session | null;
  isAuthenticated: boolean;
}

export interface Route {
  method: string;
  pattern: RegExp;
  handler: (ctx: RequestContext, match: RegExpMatchArray) => Promise<void> | void;
}

export interface HttpDeps {
  config: RelayConfig;
  auth: AuthManager;
  instanceManager: InstanceManager;
  startedAt: number;
  packageVersion: string;
  uiDistDir: string;
  indexHtmlPath: string;
  getConnectionCount?: () => number;
  getProviderModels: (provider: ProviderKind) => Promise<ProviderModelOption[]>;
  getProviderCapabilities: (provider: ProviderKind) => ProviderCapabilities;
  getAvailableProviders: () => ProviderDescriptor[];
  getOpenTargets: (targetPath: string) => Promise<NativeOpenTargetsResponse>;
  openNativePath: (request: NativeOpenRequest) => Promise<void>;
  getGitRepos: () => Promise<string[]>;
}
