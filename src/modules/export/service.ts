import type { UserProfile } from "../auth/domain";
import { authRepository } from "../auth/repository";
import { cardRepository } from "../cards";
import { listCycles } from "../cycles";
import { feeEventRepository } from "../fee-events";
import { progressRepository } from "../progress";
import { reminderRepository, reminderRuleRepository } from "../reminders";
import { recordAudit } from "../../shared/audit";
import { listAuditLogs } from "../../shared/audit";

export async function exportUserData(userId: string) {
  const profile = await authRepository.findUserById(userId);
  const cards = await cardRepository.listAll(userId);
  const cycles = [];
  const progressEntries = [];
  for (const card of cards) {
    const cardCycles = await listCycles(userId, card.id);
    cycles.push(...cardCycles);
    for (const cycle of cardCycles) {
      progressEntries.push(...(await progressRepository.list(userId, cycle.id)));
    }
  }
  const feeEvents = await feeEventRepository.list(userId);
  const reminders = await reminderRepository.list(userId, false);
  const reminderRules = await reminderRuleRepository.listGlobal(userId);
  const auditLogs = await listAuditLogs(userId);
  const result = {
    profile: toExportProfile(profile),
    cards,
    cycles,
    progressEntries,
    feeEvents,
    reminders,
    reminderRules,
    auditLogs,
    exportedAt: new Date().toISOString(),
  };
  await recordAudit({
    userId,
    actorType: "user",
    actorId: userId,
    action: "account.exported",
    entityType: "user",
    entityId: userId,
    metadata: { format: "json" },
  });
  return result;
}

function toExportProfile(user: UserProfile | undefined) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name ?? null,
    timezone: user.timezone,
    status: user.status,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
