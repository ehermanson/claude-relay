/**
 * Authentication and session management for Relay
 *
 * Class-based design so each relay instance gets its own session store.
 * Includes IP-based rate limiting on login attempts.
 */

import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import * as cookie from "cookie";
import type { Session } from "#core/types.js";
import type { RelayConfig } from "#server/config.js";

const SESSION_COOKIE_NAME = "session";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export class AuthManager {
  private sessions = new Map<string, Session>();
  private rateLimits = new Map<string, RateLimitEntry>();
  private config: RelayConfig;

  /** True when a password is configured and auth is enforced. */
  readonly authRequired: boolean;

  constructor(config: RelayConfig) {
    this.config = config;
    this.authRequired = config.password !== undefined && config.password !== "";
    if (this.authRequired) {
      this.loadSessions();
    }
  }

  /**
   * Load sessions from the persistence file, filtering out expired ones.
   */
  private loadSessions(): void {
    const filePath = this.config.sessionFile;
    if (!filePath) return;

    try {
      const data = readFileSync(filePath, "utf-8");
      const entries: Session[] = JSON.parse(data);
      const now = Date.now();

      for (const session of entries) {
        if (session.expiresAt > now) {
          this.sessions.set(session.id, session);
        }
      }

      this.config.logger.debug(`Loaded ${this.sessions.size} session(s) from ${filePath}`);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        // File doesn't exist yet — that's fine, first run
        return;
      }
      this.config.logger.warn(`Failed to load sessions from ${filePath}: ${err}`);
    }
  }

  /**
   * Persist the current sessions map to disk.
   */
  private saveSessions(): void {
    const filePath = this.config.sessionFile;
    if (!filePath) return;

    try {
      mkdirSync(dirname(filePath), { recursive: true });
      const entries = Array.from(this.sessions.values());
      writeFileSync(filePath, JSON.stringify(entries, null, 2), "utf-8");
    } catch (err: unknown) {
      this.config.logger.warn(`Failed to save sessions to ${filePath}: ${err}`);
    }
  }

  /**
   * Check whether an IP has exceeded the rate limit.
   * Returns true if the request is allowed, false if blocked.
   */
  checkRateLimit(ip: string): boolean {
    const now = Date.now();
    const entry = this.rateLimits.get(ip);

    if (!entry || now > entry.resetAt) {
      this.rateLimits.set(ip, { count: 1, resetAt: now + this.config.rateLimitWindow });
      return true;
    }

    entry.count++;
    if (entry.count > this.config.rateLimitMax) {
      return false;
    }

    return true;
  }

  /**
   * Create a new session with a cryptographically random ID.
   */
  createSession(): Session {
    const id = randomBytes(32).toString("hex");
    const now = Date.now();

    const session: Session = {
      id,
      createdAt: now,
      expiresAt: now + this.config.sessionMaxAge,
    };

    this.sessions.set(id, session);
    this.saveSessions();
    return session;
  }

  /**
   * Validate a session ID and return the session if valid.
   */
  validateSession(sessionId: string | undefined): Session | null {
    if (!sessionId) return null;

    const session = this.sessions.get(sessionId);
    if (!session) return null;

    if (Date.now() > session.expiresAt) {
      this.sessions.delete(sessionId);
      this.saveSessions();
      return null;
    }

    return session;
  }

  /**
   * Delete a session from the store.
   */
  deleteSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.saveSessions();
  }

  /**
   * Parse session from HTTP request cookies.
   */
  getSessionFromCookies(cookieHeader: string | undefined): Session | null {
    if (!cookieHeader) return null;

    const cookies = cookie.parse(cookieHeader);
    const sessionId = cookies[SESSION_COOKIE_NAME];

    return this.validateSession(sessionId);
  }

  /**
   * Serialize a session cookie for the Set-Cookie header.
   */
  serializeSessionCookie(sessionId: string): string {
    const isProduction = process.env.NODE_ENV === "production";

    return cookie.serialize(SESSION_COOKIE_NAME, sessionId, {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
      path: "/",
      maxAge: Math.floor(this.config.sessionMaxAge / 1000),
    });
  }

  /**
   * Serialize a cookie that clears the session.
   */
  clearSessionCookie(): string {
    const isProduction = process.env.NODE_ENV === "production";

    return cookie.serialize(SESSION_COOKIE_NAME, "", {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
  }
}
