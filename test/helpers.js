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

  /** Wait for the initial connected + instance_list + projects_changed handshake. */
  ws.waitForHandshake = async () => {
    const msgs = await ws.collectMessages(3);
    assert.equal(msgs[0].type, "connected");
    assert.equal(msgs[1].type, "instance_list");
    assert.equal(msgs[2].type, "projects_changed");
    return msgs;
  };

  return ws;
}
