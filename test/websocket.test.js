import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WebSocket } from "ws";
import { createRequestHandler } from "../dist/server.js";
import { createWebSocketServer } from "../dist/websocket.js";
import { AuthManager } from "../dist/auth.js";
import { InstanceManager } from "../dist/instance-manager.js";
import { resolveConfig } from "../dist/config.js";

const noopLogger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
};

/**
 * Create a connected WebSocket with message buffering.
 * Starts buffering messages immediately so none are lost between
 * the connection opening and test code reading them.
 */
function createClient(server, sessionId) {
  const port = server.address().port;
  const headers = sessionId ? { Cookie: `session=${sessionId}` } : {};
  const ws = new WebSocket(`ws://localhost:${port}`, { headers });

  const buffer = [];
  const waiters = [];

  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString());
    if (waiters.length > 0) {
      waiters.shift()(msg);
    } else {
      buffer.push(msg);
    }
  });

  /** Wait for and return the next message (from buffer or future). */
  ws.nextMessage = (timeoutMs = 5000) => {
    if (buffer.length > 0) {
      return Promise.resolve(buffer.shift());
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timed out waiting for message")), timeoutMs);
      waiters.push((msg) => {
        clearTimeout(timeout);
        resolve(msg);
      });
    });
  };

  /** Wait for N messages. */
  ws.collectMessages = async (count, timeoutMs = 5000) => {
    const messages = [];
    for (let i = 0; i < count; i++) {
      messages.push(await ws.nextMessage(timeoutMs));
    }
    return messages;
  };

  /** Wait for the initial connected + instance_list handshake. */
  ws.waitForHandshake = async () => {
    const msgs = await ws.collectMessages(2);
    assert.equal(msgs[0].type, "connected");
    assert.equal(msgs[1].type, "instance_list");
    return msgs;
  };

  const ready = new Promise((resolve, reject) => {
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });

  return { ws, ready };
}

describe("WebSocket Server", () => {
  let server;
  let auth;
  let manager;
  let tempDir;
  let wsHandle;
  const openSockets = [];

  beforeEach((_, done) => {
    tempDir = mkdtempSync(join(tmpdir(), "relay-ws-test-"));
    const config = resolveConfig({
      password: "testpass",
      logger: noopLogger,
      maxInstances: 5,
      serveUI: false,
      rateLimitMax: 10,
      rateLimitWindow: 60_000,
      sessionFile: join(tempDir, "sessions.json"),
    });
    auth = new AuthManager(config);
    manager = new InstanceManager(config);
    const handler = createRequestHandler(config, auth, manager);
    server = http.createServer(handler);
    wsHandle = createWebSocketServer(server, manager, auth, config);
    server.listen(0, done);
  });

  afterEach((_, done) => {
    for (const ws of openSockets) {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    }
    openSockets.length = 0;
    manager.stopAll();
    rmSync(tempDir, { recursive: true, force: true });
    wsHandle.wss.close(() => {
      server.close(done);
    });
  });

  function connect(sessionId) {
    const { ws, ready } = createClient(server, sessionId);
    openSockets.push(ws);
    return ready;
  }

  describe("Authentication", () => {
    it("rejects connection without auth cookie (close code 4001)", async () => {
      const port = server.address().port;
      const ws = new WebSocket(`ws://localhost:${port}`);
      openSockets.push(ws);

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Timed out waiting for close")), 5000);
        ws.on("close", (code) => {
          clearTimeout(timeout);
          assert.equal(code, 4001);
          resolve();
        });
        ws.on("error", () => {});
      });
    });

    it("accepts connection with valid auth and sends connected + instance_list", async () => {
      const session = auth.createSession();
      const ws = await connect(session.id);
      const messages = await ws.collectMessages(2);
      assert.equal(messages[0].type, "connected");
      assert.equal(messages[1].type, "instance_list");
      assert.ok(Array.isArray(messages[1].instances));
    });
  });

  describe("create_instance", () => {
    it("creates an instance and broadcasts instance_created", async () => {
      const session = auth.createSession();
      const ws = await connect(session.id);
      await ws.waitForHandshake();

      ws.send(JSON.stringify({ type: "create_instance", name: "WS Test" }));

      const msg = await ws.nextMessage();
      assert.equal(msg.type, "instance_created");
      assert.equal(msg.instance.name, "WS Test");
      assert.ok(msg.instance.id);
    });
  });

  describe("subscribe", () => {
    it("subscribes to an instance and receives instance_history", async () => {
      const session = auth.createSession();
      const ws = await connect(session.id);
      await ws.waitForHandshake();

      // Create instance directly (no broadcast emitted for managed instances)
      const info = manager.createInstance({ name: "Sub Test" });

      ws.send(JSON.stringify({ type: "subscribe", instanceId: info.id }));

      const msg = await ws.nextMessage();
      assert.equal(msg.type, "instance_history");
      assert.equal(msg.instanceId, info.id);
      assert.ok(Array.isArray(msg.history));
    });
  });

  describe("list_instances", () => {
    it("returns instance_list on request", async () => {
      const session = auth.createSession();
      const ws = await connect(session.id);
      await ws.waitForHandshake();

      // Create instances directly (no broadcasts for managed instances)
      manager.createInstance({ name: "A" });
      manager.createInstance({ name: "B" });

      ws.send(JSON.stringify({ type: "list_instances" }));

      const msg = await ws.nextMessage();
      assert.equal(msg.type, "instance_list");
      assert.equal(msg.instances.length, 2);
    });
  });

  describe("remove_instance", () => {
    it("removes an instance and broadcasts instance_removed", async () => {
      const session = auth.createSession();
      const ws = await connect(session.id);
      await ws.waitForHandshake();

      // Create instance directly
      const info = manager.createInstance({ name: "ToRemove" });

      ws.send(JSON.stringify({ type: "remove_instance", instanceId: info.id }));

      const msg = await ws.nextMessage();
      assert.equal(msg.type, "instance_removed");
      assert.equal(msg.instanceId, info.id);
      assert.equal(manager.listInstances().length, 0);
    });

    it("sends error for non-existent instance", async () => {
      const session = auth.createSession();
      const ws = await connect(session.id);
      await ws.waitForHandshake();

      ws.send(JSON.stringify({ type: "remove_instance", instanceId: "00000000-0000-0000-0000-000000000000" }));

      const msg = await ws.nextMessage();
      assert.equal(msg.type, "error");
      assert.ok(msg.message.includes("not found"));
    });
  });
});
