#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const HIGH_IMPACT_NODE_TESTS = [
  "test/server.test.js",
  "test/http-routes.test.js",
  "test/websocket.test.js",
  "test/websocket-messages.test.js",
  "test/terminal-websocket.test.js",
  "test/instance-manager.test.js",
  "test/search.test.js",
  "test/worktree-detection.test.js",
];

const HIGH_IMPACT_BACKEND_RE = [
  /^server\/websocket\.ts$/,
  /^server\/http\.ts$/,
  /^server\/config\.ts$/,
  /^server\/routes\//,
  /^server\/core\/(db|git|instance-manager|provider-registry|types)\.ts$/,
];

function getStagedFiles() {
  const stdout = execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR"], {
    encoding: "utf8",
  });
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function isBackendFile(file) {
  return (
    file.startsWith("server/") ||
    file.startsWith("cli/") ||
    file.startsWith("test/") ||
    file === "package.json" ||
    file === "tsconfig.json"
  );
}

function isAppFile(file) {
  return file.startsWith("app/") || file === "package.json";
}

function importedTestPathFor(file) {
  if (file.startsWith("server/")) return `../dist/${file.replace(/\.ts$/, ".js")}`;
  if (file.startsWith("cli/")) return `../dist/${file.replace(/\.ts$/, ".js")}`;
  return null;
}

function findImportingTests(importPath) {
  if (!importPath) return [];
  try {
    const stdout = execFileSync(
      "rg",
      ["-l", "--glob", "test/*.test.js", "--fixed-strings", importPath, "test"],
      { encoding: "utf8" },
    );
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function addAll(set, values) {
  for (const value of values) {
    if (existsSync(value)) set.add(value);
  }
}

const stagedFiles = getStagedFiles();
if (stagedFiles.length === 0) {
  process.exit(0);
}

const needsAppTests = stagedFiles.some(isAppFile);
const backendFiles = stagedFiles.filter(isBackendFile);
const needsServerBuild = backendFiles.some((file) => /\.(ts|js|json)$/.test(file));

const nodeTests = new Set(stagedFiles.filter((file) => /^test\/.+\.test\.js$/.test(file)));
for (const file of backendFiles) {
  addAll(nodeTests, findImportingTests(importedTestPathFor(file)));
}

if (backendFiles.some((file) => HIGH_IMPACT_BACKEND_RE.some((pattern) => pattern.test(file)))) {
  addAll(nodeTests, HIGH_IMPACT_NODE_TESTS);
}

if (needsServerBuild) {
  console.log("Running staged server build...");
  run("pnpm", ["build:server"]);
}

if (nodeTests.size > 0) {
  console.log(`Running staged node tests (${nodeTests.size})...`);
  run("pnpm", [
    "exec",
    "node",
    "--import",
    "./test/test-env.js",
    "--test-concurrency=1",
    "--test",
    ...Array.from(nodeTests).sort(),
  ]);
}

if (needsAppTests) {
  console.log("Running app tests...");
  run("pnpm", ["--filter", "relay-app", "test"]);
}
