#!/usr/bin/env bash
set -euo pipefail

# Relay installer
# Usage: curl -fsSL https://raw.githubusercontent.com/ehermanson/relay/main/install.sh | bash

REPO="https://github.com/ehermanson/relay.git"
INSTALL_DIR="${RELAY_DIR:-$HOME/.relay/app}"
BIN_DIR="${BIN_DIR:-$HOME/.local/bin}"

info()  { printf "\033[1m%s\033[0m\n" "$*"; }
error() { printf "\033[31m%s\033[0m\n" "$*" >&2; exit 1; }

# ── Prerequisites ──────────────────────────────────────────────────

command -v git  >/dev/null || error "git is required"
command -v node >/dev/null || error "node is required (v22+)"
command -v pnpm >/dev/null || error "pnpm is required (npm i -g pnpm)"

NODE_MAJOR=$(node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
[ "$NODE_MAJOR" -ge 22 ] 2>/dev/null || error "Node.js 22+ required (found v$(node -v))"

# ── Clone or update ───────────────────────────────────────────────

if [ -d "$INSTALL_DIR/.git" ]; then
  info "Updating Relay in $INSTALL_DIR..."
  git -C "$INSTALL_DIR" pull --ff-only
else
  info "Cloning Relay to $INSTALL_DIR..."
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone "$REPO" "$INSTALL_DIR"
fi

# ── Build ──────────────────────────────────────────────────────────

cd "$INSTALL_DIR"
info "Installing dependencies..."
pnpm install --frozen-lockfile 2>/dev/null || pnpm install

info "Building..."
pnpm build

# ── Link binary ───────────────────────────────────────────────────

mkdir -p "$BIN_DIR"
ln -sf "$INSTALL_DIR/dist/cli/bin.js" "$BIN_DIR/relay"
chmod +x "$BIN_DIR/relay"

# ── PATH check ────────────────────────────────────────────────────

if ! echo "$PATH" | tr ':' '\n' | grep -qx "$BIN_DIR"; then
  info ""
  info "Add $BIN_DIR to your PATH:"
  info "  export PATH=\"$BIN_DIR:\$PATH\""
  info ""
  info "Add that line to your ~/.zshrc or ~/.bashrc to make it permanent."
fi

info ""
info "Relay installed. Run: relay start"
info "Then open http://localhost:7777"
info ""
info "To update later: curl -fsSL https://raw.githubusercontent.com/ehermanson/relay/main/install.sh | bash"
