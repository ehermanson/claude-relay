/**
 * Shared test helpers for WebSocket-based tests.
 */

import assert from "node:assert/strict";

/**
 * Enhance a WebSocket client with typed message helpers.
 * Expects `ws.nextMessage(timeoutMs)` to already be defined (buffer-backed).
 */
export function addWSHelpers(ws) {
  /** Wait for the next message of a specific type, skipping others. */
  ws.nextMessageOfType = async (type, timeoutMs = 5000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      const msg = await ws.nextMessage(remaining);
      if (msg.type === type) return msg;
    }
    throw new Error(`Timed out waiting for message of type "${type}"`);
  };

  /** Wait for N messages. */
  ws.collectMessages = async (count, timeoutMs = 5000) => {
    const messages = [];
    for (let i = 0; i < count; i++) {
      messages.push(await ws.nextMessage(timeoutMs));
    }
    return messages;
  };

  /** Wait for the initial handshake, tolerating optional boot-time messages. */
  ws.waitForHandshake = async () => {
    const msgs = [];
    while (msgs.length < 8) {
      const msg = await ws.nextMessage();
      msgs.push(msg);
      if (msg.type !== "projects_changed") continue;

      assert.equal(msgs[0]?.type, "connected");
      assert.equal(msgs[1]?.type, "instance_list");
      assert.ok(
        msgs.some((entry) => entry.type === "projects_changed"),
        "expected projects_changed in handshake",
      );
      return msgs;
    }
    throw new Error("Timed out waiting for handshake");
  };

  return ws;
}
