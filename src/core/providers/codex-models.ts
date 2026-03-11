import { spawn } from "node:child_process";
import type { Logger } from "../logger.js";
import type { ProviderModelOption } from "../types.js";
import { findCodexBinary } from "./codex-cli.js";

type SpawnFn = typeof spawn;

interface CodexAppServerResponse {
  id?: number | string;
  result?: {
    data?: Array<{
      id?: string;
      model?: string;
      displayName?: string;
      description?: string;
      hidden?: boolean;
      isDefault?: boolean;
      availabilityNux?: { message?: string } | null;
      upgrade?: string | null;
    }>;
  };
  error?: {
    code?: number;
    message?: string;
  };
}

export interface DiscoverCodexModelsOptions {
  codexPath?: string;
  includeHidden?: boolean;
  logger?: Logger;
  spawnProcess?: SpawnFn;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5_000;

export async function discoverCodexModels(
  options: DiscoverCodexModelsOptions = {},
): Promise<ProviderModelOption[]> {
  const logger = options.logger;
  const spawnProcess = options.spawnProcess ?? spawn;
  const codexPath = options.codexPath ?? findCodexBinary();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const includeHidden = options.includeHidden ?? false;

  if (!codexPath) {
    return Promise.resolve([]);
  }

  return new Promise((resolve, reject) => {
    const child = spawnProcess(codexPath, ["app-server", "--listen", "stdio://"], {
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let buffer = "";
    let stderr = "";
    let settled = false;
    let initialized = false;

    const finish = (err: Error | null, models?: ProviderModelOption[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.stdout?.removeListener("data", onStdout);
      child.stderr?.removeListener("data", onStderr);
      child.removeListener("error", onError);
      child.removeListener("close", onClose);
      if (child.exitCode === null && !child.killed) {
        child.kill("SIGKILL");
      }
      if (err) reject(err);
      else resolve(models ?? []);
    };

    const onError = (err: Error) => {
      finish(err);
    };

    const onClose = (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      const suffix = stderr.trim() ? `: ${stderr.trim()}` : "";
      finish(
        new Error(
          `Codex app-server exited before returning model metadata (${code ?? signal ?? "unknown"})${suffix}`,
        ),
      );
    };

    const sendRequest = (id: number, method: string, params: unknown) => {
      child.stdin?.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    };

    const handleLine = (line: string) => {
      let message: CodexAppServerResponse;
      try {
        message = JSON.parse(line) as CodexAppServerResponse;
      } catch {
        return;
      }

      if (message.error) {
        finish(
          new Error(
            `Codex app-server request failed: ${message.error.message ?? `code ${message.error.code ?? "unknown"}`}`,
          ),
        );
        return;
      }

      if (message.id === 1) {
        initialized = true;
        sendRequest(2, "model/list", { includeHidden, limit: 100 });
        return;
      }

      if (message.id !== 2 || !initialized) {
        return;
      }

      const models = (message.result?.data ?? [])
        .filter((item) => item.id && item.model)
        .map<ProviderModelOption>((item) => ({
          provider: "codex",
          id: item.model as string,
          label: item.displayName || (item.model as string),
          description: item.description || undefined,
          hidden: item.hidden ?? false,
          isDefault: item.isDefault ?? false,
          availabilityNote: item.availabilityNux?.message || undefined,
          upgradeTo: item.upgrade || undefined,
        }));

      finish(null, models);
    };

    const onStdout = (chunk: Buffer | string) => {
      buffer += chunk.toString();
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line) handleLine(line);
        newlineIndex = buffer.indexOf("\n");
      }
    };

    const onStderr = (chunk: Buffer | string) => {
      const text = chunk.toString();
      stderr += text;
      if (stderr.length > 4000) {
        stderr = stderr.slice(-4000);
      }
      logger?.debug?.(`[discoverCodexModels] stderr: ${text.trim()}`);
    };

    const timeout = setTimeout(() => {
      finish(new Error(`Timed out after ${timeoutMs}ms while discovering Codex models`));
    }, timeoutMs);

    child.stdout?.on("data", onStdout);
    child.stderr?.on("data", onStderr);
    child.on("error", onError);
    child.on("close", onClose);

    sendRequest(1, "initialize", {
      clientInfo: {
        name: "relay",
        version: "0.0.0",
      },
      capabilities: {
        experimentalApi: true,
      },
    });
  });
}
