import type { Hono } from "hono";
import { readJsonBody } from "#server/hono-utils.js";
import type { AppEnv, HttpDeps } from "#server/route-types.js";
import { renderSpinOffPacket } from "#core/spin-off-manager.js";

export function registerSpinOffRoutes(app: Hono<AppEnv>, deps: HttpDeps): void {
  const { instanceManager } = deps;

  /**
   * POST /api/spin-offs — Generate a spin-off draft from a source chat.
   *
   * Body: { sourceChatId: string, anchorIndex?: number }
   * Returns: SpinOffInfo with rendered text
   */
  app.post("/api/spin-offs", async (c) => {
    const body = await readJsonBody<{
      sourceChatId: string;
      anchorIndex?: number;
    }>(c);

    if (!body.sourceChatId) {
      return c.json({ error: "sourceChatId is required" }, 400);
    }

    const summary = instanceManager.getChatSummary(body.sourceChatId);
    if (!summary) {
      return c.json({ error: "Source chat not found" }, 404);
    }

    let history;
    try {
      history = instanceManager.getHistory(body.sourceChatId);
    } catch {
      return c.json({ error: "Could not read source chat history" }, 400);
    }

    const changedFiles = instanceManager.getChangedFiles(body.sourceChatId);

    const spinOff = instanceManager.getSpinOffManager().createSpinOff({
      sourceChatId: body.sourceChatId,
      sourceChatName: summary.name,
      history,
      changedFiles,
      anchorIndex: body.anchorIndex,
    });

    const text = renderSpinOffPacket(spinOff.packet, spinOff.sourceChatName);

    return c.json({ ...spinOff, renderedText: text }, 201);
  });

  /**
   * GET /api/spin-offs/:id — Get a spin-off by ID.
   */
  app.get("/api/spin-offs/:id", (c) => {
    const spinOff = instanceManager.getSpinOffManager().getSpinOff(c.req.param("id"));
    if (!spinOff) {
      return c.json({ error: "Spin-off not found" }, 404);
    }
    const text = renderSpinOffPacket(spinOff.packet, spinOff.sourceChatName);
    return c.json({ ...spinOff, renderedText: text });
  });

  /**
   * POST /api/spin-offs/:id/send — Mark a spin-off as sent to a target chat.
   *
   * Body: { targetChatId: string }
   */
  app.post("/api/spin-offs/:id/send", async (c) => {
    const body = await readJsonBody<{ targetChatId: string }>(c);
    if (!body.targetChatId) {
      return c.json({ error: "targetChatId is required" }, 400);
    }

    const targetSummary = instanceManager.getChatSummary(body.targetChatId);
    const spinOff = instanceManager
      .getSpinOffManager()
      .markSent(c.req.param("id"), body.targetChatId, targetSummary?.name ?? null);

    if (!spinOff) {
      return c.json({ error: "Spin-off not found" }, 404);
    }

    return c.json(spinOff);
  });

  /**
   * GET /api/chats/:id/spin-offs — Get spin-offs related to a chat (sent and received).
   */
  app.get("/api/chats/:id/spin-offs", (c) => {
    const chatId = c.req.param("id");
    const manager = instanceManager.getSpinOffManager();
    return c.json({
      sent: manager.getSpinOffsFromChat(chatId),
      received: manager.getSpinOffsToChat(chatId),
    });
  });
}
