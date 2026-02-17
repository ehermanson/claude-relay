# Claude Relay

Remote access to your local Claude Code instance through a mobile-friendly web interface. Use it as a CLI tool or embed it as a library in your own project.

## Quick Start

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Start the server (password is required)
RELAY_PASSWORD="your-secret" npm start
```

Then open `http://localhost:7777` in your browser.

## Remote Access

To access from other devices, use [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/):

```bash
# Install cloudflared (macOS)
brew install cloudflared

# Create a tunnel to your local server
cloudflared tunnel --url http://localhost:7777
```

This gives you a public URL like `https://random-words.trycloudflare.com` that you can open on your phone.

## Library Usage

Claude Relay can be used as a library in your own Node.js application:

```ts
import { createRelay } from "claude-relay";

const relay = createRelay({
  password: "my-secret",
  port: 8080,
  dangerouslySkipPermissions: true,
  workingDirectory: "/path/to/project",
});

await relay.start();

// Later, shut down gracefully:
await relay.stop();
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `password` | `string` | **(required)** | Authentication password |
| `port` | `number` | `7777` | Server port |
| `dangerouslySkipPermissions` | `boolean` | `false` | Skip Claude's permission prompts |
| `processTimeout` | `number` | `300000` | Claude process timeout in ms (5 min) |
| `workingDirectory` | `string` | `process.cwd()` | Working directory for Claude |
| `serveUI` | `boolean` | `true` | Serve the built-in web UI |
| `sessionMaxAge` | `number` | `604800000` | Session lifetime in ms (7 days) |
| `rateLimitMax` | `number` | `5` | Max login attempts per IP per window |
| `rateLimitWindow` | `number` | `60000` | Rate limit window in ms (1 min) |
| `logger` | `Logger` | `console` | Custom logger implementation |

## CLI Configuration

When running via `npm start`, all configuration is through environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `RELAY_PASSWORD` | **(required)** | Authentication password |
| `PORT` | `7777` | Server port |
| `SESSION_MAX_AGE` | `604800000` | Session lifetime in ms (7 days) |
| `PROCESS_TIMEOUT` | `300000` | Claude process timeout in ms (5 min) |
| `WORKING_DIR` | `$HOME` | Working directory for Claude |
| `DANGEROUS_SKIP_PERMISSIONS` | `false` | Set to `"true"` to skip Claude permission prompts |

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                     YOUR MAIN MACHINE                       │
│                                                             │
│   ┌─────────────┐      ┌─────────────┐      ┌───────────┐  │
│   │   Claude    │◄────►│   Relay     │◄────►│ Cloudflare│  │
│   │    Code     │      │   Server    │  WS  │  Tunnel   │  │
│   └─────────────┘      └─────────────┘      └───────────┘  │
└─────────────────────────────────────────────────────────────┘
                                                      │
                                              Secure tunnel
                                                      │
                        ┌───────────────────────────┼───────────────────────────┐
                        │                           │                           │
                        ▼                           ▼                           ▼
                   ┌─────────┐                ┌──────────┐               ┌───────────┐
                   │  Phone  │                │  Laptop  │               │  Browser  │
                   └─────────┘                └──────────┘               └───────────┘
```

1. **Claude Relay** runs on your main machine alongside Claude Code
2. **Cloudflare Tunnel** creates a secure connection from the internet to your machine
3. **Your phone/browser** connects to the tunnel URL
4. **Chat interface** sends your messages to Claude Code and streams responses back

## Development

```bash
# Watch mode (rebuild on changes)
npm run dev
```

## Security

- **No default password** — the server refuses to start without one
- **Rate limiting** — login attempts are rate-limited per IP (5/min by default)
- **Safe by default** — `dangerouslySkipPermissions` is off unless you opt in
- Password authentication with secure, HttpOnly, SameSite session cookies
- Sessions expire after 7 days (configurable)
- Designed to run behind Cloudflare Tunnel (HTTPS)
