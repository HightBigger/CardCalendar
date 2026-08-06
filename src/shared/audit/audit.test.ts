import { describe, expect, it } from "vitest";
import { listAuditLogs, recordAudit } from "./index";

describe("audit log", () => {
  it("records and filters user events without exposing other users", async () => {
    const userId = crypto.randomUUID();
    const otherUserId = crypto.randomUUID();

    await recordAudit({
      userId,
      actorType: "user",
      actorId: userId,
      action: "card.archived",
      entityType: "card",
      entityId: crypto.randomUUID(),
      metadata: { status: "archived" },
    });
    await recordAudit({
      userId: otherUserId,
      actorType: "user",
      actorId: otherUserId,
      action: "card.archived",
      entityType: "card",
      metadata: {},
    });

    const logs = await listAuditLogs(userId);
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe("card.archived");
    expect(logs[0].metadata).toEqual({ status: "archived" });
  });
});
