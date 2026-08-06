import { eq } from "drizzle-orm";
import { cards, feeCycles, feeEvents, progressEntries, reminderRules, reminders, sessions } from "../../../db/schema";
import { authRepository } from "../auth";
import { getDatabase } from "../../shared/db/client";
import { getMemoryStore } from "../../shared/store/memory";
import { recordAudit } from "../../shared/audit";

export async function runAccountCleanup() {
  const users = await authRepository.listDeletionRequestedUsers();
  const results: Array<{
    userId: string;
    status: "completed" | "failed";
    retryCount: number;
    completedAt?: string;
    error?: string;
  }> = [];
  for (const user of users) {
    const retryCount = (user.deletionRetryCount ?? 0) + 1;
    try {
      if (process.env.USE_DATABASE === "true") {
        await cleanupPostgres(user.id);
      } else {
        cleanupMemory(user.id);
      }
      const now = new Date().toISOString();
      await authRepository.anonymizeUser(user.id);
      await authRepository.updateUser(user.id, {
        deletionCleanupCompletedAt: now,
        deletionCleanupResult: { completed: true, cleanedAt: now },
        deletionRetryCount: retryCount,
      });
      await recordAudit({
        userId: user.id,
        actorType: "system",
        action: "account.anonymized",
        entityType: "user",
        entityId: user.id,
        metadata: { completedAt: now, retryCount },
      });
      results.push({ userId: user.id, status: "completed", retryCount, completedAt: now });
    } catch (caught) {
      const error = caught instanceof Error ? caught.message : "unknown cleanup error";
      await authRepository.updateUser(user.id, {
        deletionRetryCount: retryCount,
        deletionCleanupResult: { completed: false, error },
      });
      await recordAudit({
        userId: user.id,
        actorType: "system",
        action: "account.cleanup_failed",
        entityType: "user",
        entityId: user.id,
        metadata: { retryCount, error },
      });
      results.push({ userId: user.id, status: "failed", retryCount, error });
    }
  }
  return { anonymizedUsers: results.filter((item) => item.status === "completed").length, results };
}

async function cleanupPostgres(userId: string) {
  const db = getDatabase().db;
  await db.transaction(async (tx) => {
    await tx.delete(progressEntries).where(eq(progressEntries.userId, userId));
    await tx.delete(reminderRules).where(eq(reminderRules.userId, userId));
    await tx.delete(reminders).where(eq(reminders.userId, userId));
    await tx.delete(feeEvents).where(eq(feeEvents.userId, userId));
    await tx.delete(feeCycles).where(eq(feeCycles.userId, userId));
    await tx.delete(cards).where(eq(cards.userId, userId));
    await tx.delete(sessions).where(eq(sessions.userId, userId));
  });
}

function cleanupMemory(userId: string) {
  const store = getMemoryStore();
  for (const map of [
    store.progressEntries,
    store.reminderRules,
    store.reminders,
    store.feeEvents,
    store.cycles,
    store.cards,
    store.sessions,
  ]) {
    for (const [id, value] of map) {
      if ((value as { userId?: string }).userId === userId) map.delete(id);
    }
  }
}
