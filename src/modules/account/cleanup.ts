import { eq } from "drizzle-orm";
import { cards, feeCycles, feeEvents, progressEntries, reminderRules, reminders, sessions } from "../../../db/schema";
import { authRepository } from "../auth";
import { getDatabase } from "../../shared/db/client";
import { getMemoryStore } from "../../shared/store/memory";

export async function runAccountCleanup() {
  const users = await authRepository.listDeletionRequestedUsers();
  const anonymizedUsers: string[] = [];
  for (const user of users) {
    if (process.env.USE_DATABASE === "true") {
      await cleanupPostgres(user.id);
    } else {
      cleanupMemory(user.id);
    }
    await authRepository.anonymizeUser(user.id);
    anonymizedUsers.push(user.id);
  }
  return { anonymizedUsers: anonymizedUsers.length };
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
