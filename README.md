# Relay

A lightweight bridge between remote devices and your local AI coding agents. Run it on your dev machine, connect from your phone or laptop, and manage your agent sessions from anywhere.

Relay also automatically discovers agent sessions running on your machine and lets you monitor or resume them from the web UI.

> **Fair warning:** This project is held together with duct tape and optimism. It relies on undocumented transcript formats (Claude Code's JSONL, Codex's session files), CLI flags, and directory layouts (`~/.claude/`, `~/.codex/`) that could change without notice. Any provider CLI update could break things in spectacular and unexpected ways. There is no stable API contract here — just a guy reading transcript files and hoping for the best. If it works today, celebrate. If it breaks tomorrow, that's expected.

![Relay](claude-relay.png)

## How It Works

```
                          YOUR DEV MACHINE
  ┌──────────────────────────────────────────────────────────────┐
  │                                                              │
  │   Terminal sessions           Relay                          │
  │  ┌──────────────────┐       ┌──────────────────────────┐     │
  │  │ $ claude          │──┐   │                          │     │
  │  │ $ claude          │──┤   │  InstanceManager         │     │
  │  │ $ codex           │──┘   │    ┌───────────────────┐ │     │
  │  └──────────────────┘  ▲    │    │ ProviderSession ×N│ │     │
  │     discovered via     │    │    └───────────────────┘ │     │
  │     ps + JSONL watch ──┘    │                          │     │
  │                             │  HTTP   ─── REST API     │     │
  │                             │  WebSocket ─ streaming   │     │
  │                             │  Auth   ─── sessions     │     │
  │                             │  UI     ─── React SPA    │     │
  │                             └──────┬─────────┬─────────┘     │
  │                                    │         │               │
  │                     ┌──────────────┴┐  ┌─────┴────────────┐  │
  │                     │  Tailscale    │  │  cloudflared      │  │
  │                     │  (tailnet)    │  │  (public tunnel)  │  │
  │                     └──────────────┬┘  └─────┬────────────┘  │
  └────────────────────────────────────┼─────────┼───────────────┘
                                       │         │
                                 tailnet mesh   HTTPS tunnel
                                       │         │
                              ┌────────┴─┐  ┌────┴─────┐
                              │  Phone   │  │  Laptop  │
                              └──────────┘  └──────────┘
```

1. **Relay** runs on your dev machine alongside your coding agents
2. **InstanceManager** spawns and manages provider-backed sessions through the provider-driver registry
3. **Session discovery** finds agent sessions running in terminals and streams their transcripts
4. **WebSocket** streams output, activity, and status changes to subscribed browser clients
5. **Tailscale** (optional) makes the relay reachable from any device on your private tailnet
6. **Cloudflare Tunnel** (optional) gives you a public HTTPS URL for access from any device

## Architecture

### Provider Registry

Relay's backend is organized around a **provider-driver registry**. Each provider declares its capabilities and owns its own session lifecycle behind a shared contract:

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │                        Provider Registry                            │
  │                                                                     │
  │  ┌─────────────┐   ┌─────────────┐                                 │
  │  │  Claude      │   │  Codex      │  ← Drivers                     │
  │  │  SDK / CLI   │   │  app-server │                                 │
  │  └──────┬───────┘   └──────┬──────┘                                 │
  │         │                  │                                        │
  │         ▼                  ▼                                        │
  │  ┌──────────────────────────────────────────────────────────┐       │
  │  │              ProviderSession contract                    │       │
  │  │  send() · interrupt() · close() · setModel()            │       │
  │  │  setReasoningBudget() · setPlanMode()                    │       │
  │  │  getRuntimeBinding() · respondToRequest()                │       │
  │  └──────────────────────────────────────────────────────────┘       │
  │         │                                                           │
  │         ▼                                                           │
  │  ┌──────────────────────────────────────────────────────────┐       │
  │  │              ProviderCapabilities                        │       │
  │  │  supportsResume · supportsApprovals · supportsPlanMode   │       │
  │  │  supportsReasoningBudget · supportsModelSelection · ...  │       │
  │  └──────────────────────────────────────────────────────────┘       │
  └─────────────────────────────────────────────────────────────────────┘
```

Each driver implements: `isAvailable()`, `createSession()`, `getModels()`, `parseTranscript()`, `resolveManagedTranscriptPath()`, and `captureManagedSession()`. The UI never hardcodes provider-specific logic — it queries `GET /api/providers` for available providers and `GET /api/provider-models?provider=...` for model lists and capabilities, then shows or hides controls accordingly.

### Data Flow

```
  ┌────────────┐
  │  React UI  │
  │  (Vite)    │
  └─────┬──────┘
        │ WebSocket (JSON)
        ▼
  ┌────────────────┐     subscribe/unsubscribe per instance
  │  WS Server     │───► broadcast: status, create, remove → all clients
  │                │───► scoped: output, activity, exit → subscribers only
  └─────┬──────────┘
        │
        ▼
  ┌────────────────────────────────────────────────────────────┐
  │                    InstanceManager                          │
  │                                                            │
  │  instances: Map<id, Instance>                              │
  │                                                            │
  │  ┌──────────────────┐   ┌──────────────────┐               │
  │  │  Managed          │   │  External         │              │
  │  │  ProviderSession  │   │  JSONL watcher    │              │
  │  │  (live process)   │   │  (2s poll)        │              │
  │  └────────┬─────────┘   └────────┬──────────┘              │
  │           │                      │                          │
  │           ▼                      ▼                          │
  │  ┌─────────────────────────────────────────────────┐       │
  │  │  Unified event stream                           │       │
  │  │  output · activity · stats · exit               │       │
  │  └─────────────────────────────────────────────────┘       │
  │           │                                                 │
  │           ▼                                                 │
  │  ┌─────────────────────────────────────────────────┐       │
  │  │  SessionDB (SQLite)                             │       │
  │  │  sessions: rebuildable transcript index         │       │
  │  │  managed_sessions: provider runtime bindings    │       │
  │  └─────────────────────────────────────────────────┘       │
  └────────────────────────────────────────────────────────────┘
```

### Session Lifecycle

```
  New chat request
        │
        ▼
  ┌──────────────┐    Provider registry picks driver
  │ createSession│───► driver.createSession()
  └──────┬───────┘    returns ProviderSession
         │
         ▼
  ┌──────────────┐    First response arrives
  │ Capture      │───► extract session ID + transcript path
  │ session ID   │    persist runtime binding to SQLite
  └──────┬───────┘
         │
         ▼
  ┌──────────────┐    User sends messages
  │ Active       │───► provider session handles send/resume
  │              │    transcript watcher tracks changes
  └──────┬───────┘
         │
         ▼
  ┌──────────────┐    Relay restarts
  │ Persisted    │───► SQLite has runtime binding
  │ (stopped)    │    sidebar renders from cached metadata
  └──────┬───────┘
         │
         ▼
  ┌──────────────┐    User opens the session
  │ Lazy hydrate │───► replay transcript, restore state
  │              │    boot provider session if resumable
  └──────────────┘
```

### External Session Discovery

```
  Every 10 seconds:
  ┌──────────────┐
  │ ps -eo pid   │───► find agent CLI processes
  └──────┬───────┘     (exclude managed PIDs)
         │
         ▼
  ┌──────────────┐
  │ lsof -p PID  │───► resolve working directory
  └──────┬───────┘
         │
         ▼
  ┌──────────────┐
  │ Match trans- │───► provider-specific transcript paths
  │ cript files  │    (e.g. ~/.claude/projects/, ~/.codex/sessions/)
  └──────┬───────┘
         │
         ▼
  ┌──────────────┐
  │ Start watch  │───► 2s poll, emit new entries
  └──────┬───────┘
         │
         ▼
  ┌──────────────┐     User sends message from UI
  │ Resume       │───► stop external process
  │ (optional)   │    spawn managed provider session
  └──────────────┘
```

### Package Structure

The package exposes two entry points:

```ts
// Core only — embed process management in your own app
import { InstanceManager } from "relay";

// Full server — HTTP + WebSocket + auth + UI
import { createRelay } from "relay/server";
```

The server entry point re-exports everything from core, so you never need to import from both.

## Projects and Directories

Relay organizes work around explicitly registered git projects. A project is opt-in: once you add a repo, Relay discovers sessions for that repo, groups chats under that project in the sidebar, and aggregates project artifacts (plans, memory, docs) on the project page.

Sessions still carry a working directory, and that directory remains the agent's "home base," not a sandbox. Nothing prevents a session started in `~/projects/foo` from editing files in `~/projects/bar`. But visibility and discovery now key off registered projects, with Relay normalizing registrations to the repo root.

## What It Does

- **Multi-session management** — run multiple agent instances side-by-side, each with its own working directory and conversation history
- **Multi-provider support** — managed sessions for Claude and Codex, with a provider picker in the UI
- **External session discovery** — automatically detects agent sessions running in terminals and streams their output in real time
- **Resume external sessions** — take over a terminal-started session from the web UI
- **Per-session controls** — model picker, reasoning effort, and build/plan mode toggle, driven by provider capabilities
- **Plan review normalization** — Codex `<proposed_plan>` blocks are surfaced through the same plan-review UI used by provider plan mode, both live and from transcript replay
- **Provider handoff** — switch providers mid-project, optionally carrying recent context into the new session
- **Interactive tool responses** — when the agent asks a question or requests approval, the composer becomes an answer form
- **Slash commands** — `/model` and `/reasoning` from the composer command palette
- **`@` file mentions** — workspace search with inline mention chips
- **Lazy hydration** — sidebar renders instantly from cached metadata; full transcript replay happens when you open a session
- **Git worktree support** — sessions in relay-managed worktrees can be merged back to main from the sidebar
- **Mobile-friendly web UI** — markdown rendering, syntax highlighting, activity indicators, and framework-aware file icons
- **Remote access** — built-in Cloudflare Tunnel support, or use Tailscale for private access
- **Embeddable** — use as a standalone server or import the core library into your own app

## What It Doesn't Do

- **No model access** — this is not an API wrapper. It manages provider CLIs and SDKs on your machine. You need at least one provider installed.
- **No multi-user auth** — single password protects the whole server.
- **No multi-device sync** — persistence is local to the machine running the relay.

## Quick Start

```bash
npm install
npm run build
RELAY_PASSWORD="your-secret" npm start
```

Open `http://localhost:7777`. That's it.

### Setting a Password

The `RELAY_PASSWORD` environment variable is required:

```bash
# Inline
RELAY_PASSWORD="your-secret" npm start

# Export for current shell
export RELAY_PASSWORD="your-secret"
npm start

# Or use a .env file (not committed to git)
echo 'RELAY_PASSWORD=your-secret' > .env
source .env && npm start
```

The password protects the web UI — you'll enter it once on the login page, then a session cookie keeps you authenticated for 7 days.

### Remote Access

**Option A: Tailscale (recommended for personal use)**

If you run [Tailscale](https://tailscale.com) on your devices, the relay is already accessible — no tunnel needed:

```bash
RELAY_PASSWORD="your-secret" npm start
# → http://your-machine:7777 from any tailnet device
```

**Option B: Cloudflare Tunnel (for public URLs)**

```bash
# Built-in tunnel (requires cloudflared)
TUNNEL=true RELAY_PASSWORD="your-secret" npm start

# Or manually
cloudflared tunnel --url http://localhost:7777
```

### Export / Import

Relay still does not have true multi-device sync, but it can now export a local migration bundle and import it on another machine.

```bash
# Create a directory bundle with a DB snapshot + Claude/Codex JSONL transcripts
relay export ~/relay-export

# Merge that bundle into another install
relay import ~/relay-export

# Or create/import a single tarball
relay export-tgz ~/relay-export.tgz
relay import-tgz ~/relay-export.tgz

# Or from this repo without installing globally
npm run relay:export -- ~/relay-export
npm run relay:import -- ~/relay-export
npm run relay:export-tgz -- ~/relay-export.tgz
npm run relay:import-tgz -- ~/relay-export.tgz
```

Notes:

- `export` / `import` use a directory bundle
- `export-tgz` / `import-tgz` wrap the same bundle format in a single `.tgz` archive
- `import` merges transcript trees into local `~/.claude/projects` and `~/.codex/sessions`
- Relay rewrites transcript paths in imported DB rows to the new machine's local provider dirs
- Project/worktree paths are best-effort; if your repos live in different places, you may need to re-register or clean up a few entries after import

## Library Usage

### Full Server

```ts
import { createRelay } from "relay/server";

const relay = createRelay({
  password: "my-secret",
  port: 8080,
  workingDirectory: "/path/to/project",
});

await relay.start();
await relay.stop();
```

### Core Only

```ts
import { InstanceManager, resolveCoreConfig } from "relay";

const config = resolveCoreConfig({
  workingDirectory: "/my/project",
  maxProcesses: 5,
});

const manager = new InstanceManager(config);
const instance = manager.createInstance({ name: "My Session", provider: "claude" });

manager.on("instance:output", (id, message) => {
  console.log(message.text);
});

manager.sendMessage(instance.id, "Hello!");
```

## Configuration

### Environment Variables

| Variable                     | Default                  | Description                          |
| ---------------------------- | ------------------------ | ------------------------------------ |
| `RELAY_PASSWORD`             | **(required)**           | Authentication password              |
| `PORT`                       | `7777`                   | Server port                          |
| `WORKING_DIR`                | `$HOME`                  | Default working directory            |
| `MAX_PROCESSES`              | `15`                     | Maximum concurrent managed processes |
| `TUNNEL`                     | `false`                  | Start a Cloudflare Tunnel            |
| `DANGEROUS_SKIP_PERMISSIONS` | `false`                  | Skip agent permission prompts        |
| `PROCESS_TIMEOUT`            | `300000`                 | Process timeout in ms (5 min)        |
| `SESSION_MAX_AGE`            | `604800000`              | Auth session lifetime in ms (7 days) |
| `SESSION_FILE`               | `~/.relay/sessions.json` | Auth session persistence file        |
| `DB_PATH`                    | `~/.relay/sessions.db`   | Relay SQLite database path           |
| `CLAUDE_DIR`                 | `~/.claude`              | Claude data directory                |
| `CODEX_DIR`                  | `~/.codex`               | Codex data directory                 |

### Programmatic Options

| Option                       | Type      | Default         | Description                      |
| ---------------------------- | --------- | --------------- | -------------------------------- |
| `password`                   | `string`  | **(required)**  | Authentication password          |
| `port`                       | `number`  | `7777`          | Server port                      |
| `workingDirectory`           | `string`  | `process.cwd()` | Default working directory        |
| `maxProcesses`               | `number`  | `15`            | Max concurrent managed processes |
| `dangerouslySkipPermissions` | `boolean` | `false`         | Skip agent permission prompts    |
| `processTimeout`             | `number`  | `300000`        | Process timeout in ms            |
| `serveUI`                    | `boolean` | `true`          | Serve the built-in web UI        |
| `sessionMaxAge`              | `number`  | `604800000`     | Auth session lifetime in ms      |
| `rateLimitMax`               | `number`  | `5`             | Max login attempts per IP/window |
| `rateLimitWindow`            | `number`  | `60000`         | Rate limit window in ms          |
| `claudeDir`                  | `string`  | `~/.claude`     | Claude transcript directory      |
| `codexDir`                   | `string`  | `~/.codex`      | Codex transcript directory       |
| `logger`                     | `Logger`  | `console`       | Custom logger implementation     |

## Security

- **No default password** — the server refuses to start without `RELAY_PASSWORD`
- **Rate limiting** — login attempts are throttled per IP (5/min default)
- **Safe by default** — `dangerouslySkipPermissions` is off unless you opt in
- **HttpOnly cookies** — session tokens are not accessible to JavaScript
- **SameSite=strict** — cookies are not sent on cross-origin requests
- Designed to run behind Cloudflare Tunnel (HTTPS) for remote access

## Development

```bash
npm run dev    # Watch mode — rebuilds server + UI on changes
npm test       # Run tests (build first: npm run build:server)
npm run typecheck  # Run server + UI TypeScript checks
npm run build  # Build everything
```

## Prerequisites

- Node.js 20+
- At least one supported provider installed and authenticated:
  - [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
  - [Codex](https://github.com/openai/codex) (`npm install -g @openai/codex`)
- [Tailscale](https://tailscale.com) (optional) or [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) (optional) for remote access
