import { describe, expect, it } from "vitest";
import { authRepository, getAccountDeletionStatus, requestAccountDeletion } from "../auth";
import { runAccountCleanup } from "./cleanup";

describe("account cleanup", () => {
  it("records deletion status, retry count and cleanup result", async () => {
    const user = await authRepository.createUser({
      email: "cleanup-" + Date.now() + "@example.com",
      passwordHash: "test-only",
      timezone: "Asia/Shanghai",
    });

    await requestAccountDeletion(user.id, { confirmation: "DELETE" }, authRepository);
    const requested = await getAccountDeletionStatus(user.id, authRepository);
    expect(requested).toMatchObject({
      status: "deletion_requested",
      deletionRetryCount: 0,
    });

    const result = await runAccountCleanup();
    const completed = result.results.find((item) => item.userId === user.id);
    expect(completed?.status).toBe("completed");

    const cleaned = await getAccountDeletionStatus(user.id, authRepository);
    expect(cleaned).toBeDefined();
    const cleanedUser = cleaned!;
    expect(cleanedUser.status).toBe("anonymized");
    expect(cleanedUser.email).toContain("@invalid.cardcalendar");
    expect(cleanedUser.deletionCleanupCompletedAt).toBeTruthy();
    expect(cleanedUser.deletionRetryCount).toBe(1);
    expect(cleanedUser.deletionCleanupResult).toMatchObject({ completed: true });
  });
});
