import { spawn } from "node:child_process";
import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type {
  NativeOpenRequest,
  NativeOpenTarget,
  NativeOpenTargetsResponse,
} from "#core/types.js";

interface ProjectOpenerOptions {
  preferencesFile: string;
}

interface StoredPreferences {
  projects: Record<string, string>;
}

interface AppCandidate {
  id: string;
  label: string;
  kind: NativeOpenTarget["kind"];
  description?: string;
  appName?: string;
  command?: string;
  bundleNames?: string[];
}

const DEFAULT_TARGET_ID = "system-default";

const MAC_TARGETS: AppCandidate[] = [
  { id: DEFAULT_TARGET_ID, label: "Finder", kind: "default" },
  {
    id: "cursor",
    label: "Cursor",
    kind: "app",
    description: "Open this project in Cursor",
    appName: "Cursor",
    bundleNames: ["Cursor.app"],
  },
  {
    id: "vscode",
    label: "Visual Studio Code",
    kind: "app",
    description: "Open this project in VS Code",
    appName: "Visual Studio Code",
    bundleNames: ["Visual Studio Code.app", "Code.app"],
  },
  {
    id: "windsurf",
    label: "Windsurf",
    kind: "app",
    description: "Open this project in Windsurf",
    appName: "Windsurf",
    bundleNames: ["Windsurf.app"],
  },
  {
    id: "zed",
    label: "Zed",
    kind: "app",
    description: "Open this project in Zed",
    appName: "Zed",
    bundleNames: ["Zed.app"],
  },
  {
    id: "xcode",
    label: "Xcode",
    kind: "app",
    description: "Open this project in Xcode",
    appName: "Xcode",
    bundleNames: ["Xcode.app"],
  },
  {
    id: "terminal",
    label: "Terminal",
    kind: "terminal",
    description: "Open this project in Terminal",
    appName: "Terminal",
    bundleNames: ["Terminal.app"],
  },
  {
    id: "warp",
    label: "Warp",
    kind: "terminal",
    description: "Open this project in Warp",
    appName: "Warp",
    bundleNames: ["Warp.app"],
  },
  {
    id: "ghostty",
    label: "Ghostty",
    kind: "terminal",
    description: "Open this project in Ghostty",
    appName: "Ghostty",
    bundleNames: ["Ghostty.app"],
  },
];

const LINUX_TARGETS: AppCandidate[] = [
  { id: DEFAULT_TARGET_ID, label: "Files", kind: "default" },
  {
    id: "cursor",
    label: "Cursor",
    kind: "app",
    description: "Open this project in Cursor",
    command: "cursor",
  },
  {
    id: "vscode",
    label: "Visual Studio Code",
    kind: "app",
    description: "Open this project in VS Code",
    command: "code",
  },
  {
    id: "zed",
    label: "Zed",
    kind: "app",
    description: "Open this project in Zed",
    command: "zed",
  },
  {
    id: "terminal",
    label: "Terminal",
    kind: "terminal",
    description: "Open this project in a terminal",
    command: "x-terminal-emulator",
  },
];

const WINDOWS_TARGETS: AppCandidate[] = [
  { id: DEFAULT_TARGET_ID, label: "Explorer", kind: "default" },
  {
    id: "cursor",
    label: "Cursor",
    kind: "app",
    description: "Open this project in Cursor",
    command: "cursor",
  },
  {
    id: "vscode",
    label: "Visual Studio Code",
    kind: "app",
    description: "Open this project in VS Code",
    command: "code",
  },
  {
    id: "zed",
    label: "Zed",
    kind: "app",
    description: "Open this project in Zed",
    command: "zed",
  },
  {
    id: "terminal",
    label: "Windows Terminal",
    kind: "terminal",
    description: "Open this project in Windows Terminal",
    command: "wt",
  },
];

export class ProjectOpener {
  private readonly preferencesFile: string;
  private cache: StoredPreferences | null = null;

  constructor(options: ProjectOpenerOptions) {
    this.preferencesFile = options.preferencesFile;
  }

  async listTargets(targetPath: string): Promise<NativeOpenTargetsResponse> {
    const resolvedPath = path.resolve(targetPath);
    const targets = await this.detectTargets();
    const preferredTargetId = this.getPreferredTargetId(resolvedPath);
    const targetIds = new Set(targets.map((target) => target.id));

    return {
      path: resolvedPath,
      preferredTargetId:
        preferredTargetId && targetIds.has(preferredTargetId) ? preferredTargetId : null,
      targets,
    };
  }

  async open(request: NativeOpenRequest): Promise<void> {
    const resolvedPath = path.resolve(request.path);
    const targetId = request.targetId?.trim() || DEFAULT_TARGET_ID;
    const targets = await this.detectTargets();
    const target = targets.find((item) => item.id === targetId);
    if (!target) {
      throw new Error("Unknown open target");
    }

    if (request.rememberForProject) {
      this.setPreferredTargetId(resolvedPath, target.id);
    }

    await launchTarget(resolvedPath, target.id);
  }

  private getPreferredTargetId(targetPath: string): string | null {
    const prefs = this.readPreferences();
    return prefs.projects[getProjectKey(targetPath)] ?? null;
  }

  private setPreferredTargetId(targetPath: string, targetId: string): void {
    const prefs = this.readPreferences();
    prefs.projects[getProjectKey(targetPath)] = targetId;
    fs.mkdirSync(path.dirname(this.preferencesFile), { recursive: true });
    fs.writeFileSync(this.preferencesFile, JSON.stringify(prefs, null, 2));
    this.cache = prefs;
  }

  private readPreferences(): StoredPreferences {
    if (this.cache) {
      return this.cache;
    }

    try {
      const raw = fs.readFileSync(this.preferencesFile, "utf8");
      const parsed = JSON.parse(raw) as Partial<StoredPreferences>;
      this.cache = {
        projects: parsed.projects && typeof parsed.projects === "object" ? parsed.projects : {},
      };
    } catch {
      this.cache = { projects: {} };
    }

    return this.cache;
  }

  private async detectTargets(): Promise<NativeOpenTarget[]> {
    if (process.platform === "darwin") {
      const installedBundles = listMacAppBundles();
      return MAC_TARGETS.filter((target) => {
        if (target.id === DEFAULT_TARGET_ID) {
          return true;
        }
        return target.bundleNames?.some((bundleName) => installedBundles.has(bundleName)) ?? false;
      }).map(toTarget);
    }

    const candidates = process.platform === "win32" ? WINDOWS_TARGETS : LINUX_TARGETS;
    const targets: NativeOpenTarget[] = [];
    for (const candidate of candidates) {
      if (!candidate.command || (await commandExists(candidate.command))) {
        targets.push(toTarget(candidate));
      }
    }
    return targets;
  }
}

function getProjectKey(targetPath: string): string {
  try {
    if (fs.statSync(targetPath).isDirectory()) {
      return targetPath;
    }
  } catch {
    // Fall back to the containing directory when the path is a file or disappears.
  }
  return path.dirname(targetPath);
}

function toTarget(candidate: AppCandidate): NativeOpenTarget {
  return {
    id: candidate.id,
    label: candidate.label,
    kind: candidate.kind,
    description: candidate.description,
  };
}

function listMacAppBundles(): Set<string> {
  const bundles = new Set<string>();
  for (const root of [
    "/Applications",
    "/Applications/Setapp",
    "/System/Applications",
    path.join(homedir(), "Applications"),
  ]) {
    collectMacBundles(root, bundles, 0);
  }
  return bundles;
}

function collectMacBundles(directory: string, bundles: Set<string>, depth: number): void {
  if (depth > 2) {
    return;
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    if (entry.name.endsWith(".app")) {
      bundles.add(entry.name);
      continue;
    }
    collectMacBundles(path.join(directory, entry.name), bundles, depth + 1);
  }
}

async function commandExists(command: string): Promise<boolean> {
  const probe = process.platform === "win32" ? "where" : "which";
  try {
    await runCommand(probe, [command], true);
    return true;
  } catch {
    return false;
  }
}

async function launchTarget(targetPath: string, targetId: string): Promise<void> {
  if (process.platform === "darwin") {
    if (targetId === DEFAULT_TARGET_ID) {
      await runCommand("open", [targetPath]);
      return;
    }

    const candidate = MAC_TARGETS.find((item) => item.id === targetId);
    if (!candidate?.appName) {
      throw new Error("Unsupported open target");
    }
    await runCommand("open", ["-a", candidate.appName, targetPath]);
    return;
  }

  if (process.platform === "win32") {
    const normalizedPath = targetPath.replaceAll("/", "\\");
    if (targetId === DEFAULT_TARGET_ID) {
      await runCommand("explorer.exe", [normalizedPath]);
      return;
    }

    const candidate = WINDOWS_TARGETS.find((item) => item.id === targetId);
    if (!candidate?.command) {
      throw new Error("Unsupported open target");
    }
    const args = targetId === "terminal" ? ["-d", normalizedPath] : [normalizedPath];
    await runCommand(candidate.command, args);
    return;
  }

  if (targetId === DEFAULT_TARGET_ID) {
    await runCommand("xdg-open", [targetPath]);
    return;
  }

  const candidate = LINUX_TARGETS.find((item) => item.id === targetId);
  if (!candidate?.command) {
    throw new Error("Unsupported open target");
  }
  const args = targetId === "terminal" ? ["--working-directory", targetPath] : [targetPath];
  await runCommand(candidate.command, args);
}

function runCommand(command: string, args: string[], waitForExit = false): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: !waitForExit,
      stdio: "ignore",
    });
    child.once("error", reject);

    if (waitForExit) {
      child.once("exit", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`${command} exited with code ${code ?? "unknown"}`));
        }
      });
      return;
    }

    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
