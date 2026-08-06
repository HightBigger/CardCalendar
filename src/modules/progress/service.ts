import { AppError } from "../../shared/errors";
import { assertISODate, formatISODate } from "../../shared/time";
import { assertRecord, nonNegativeInteger, nonNegativeNumber, optionalString } from "../../shared/validation";
import { cycleRepository, CycleRepository, getCycle } from "../cycles";
import { applyProgressEntry, calculateProgress } from "./domain";
import { progressRepository, ProgressRepository } from "./repository";
import { recordAudit } from "../../shared/audit";

export async function addProgressEntry(userId: string, cycleId: string, value: unknown, cycles: CycleRepository = cycleRepository, entries: ProgressRepository = progressRepository) {
  const cycle = await getCycle(userId, cycleId, cycles);
  if (cycle.status === "closed") throw new AppError("CONFLICT", "已关闭周期不能再更新进度");
  const body = assertRecord(value);
  if (body.mode === "cumulative" || body.currentCount !== undefined || body.currentAmount !== undefined || body.cumulativeCount !== undefined || body.cumulativeAmount !== undefined) {
    return setProgressValue(userId, cycleId, value, cycles, entries);
  }
  const countDelta = body.countDelta === undefined ? 0 : nonNegativeInteger(body.countDelta, "countDelta"); const amountDelta = body.amountDelta === undefined ? 0 : nonNegativeNumber(body.amountDelta, "amountDelta");
  if (countDelta === 0 && amountDelta === 0) throw new AppError("VALIDATION_ERROR", "次数或金额增量至少有一项大于 0");
  const entry = await entries.add({ userId, cardId: cycle.cardId, cycleId, entryDate: assertISODate(body.entryDate, "entryDate"), countDelta, amountDelta, note: optionalString(body.note, "note", 500) });
  const all = await entries.list(userId, cycleId); const valueNow = all.reduce((sum, item) => applyProgressEntry(sum, { count: item.countDelta, amount: item.amountDelta }), { count: 0, amount: 0 });
  const progress = calculateProgress({ type: cycle.waiveRuleType, targetCount: cycle.targetCount, targetAmount: cycle.targetAmount }, valueNow);
  if (progress.qualified && cycle.status === "open") await cycles.save({ ...cycle, status: "qualified" });
  await recordAudit({
    userId,
    actorType: "user",
    actorId: userId,
    action: "progress.added",
    entityType: "progress_entry",
    entityId: entry.id,
    metadata: { cycleId, countDelta, amountDelta },
  });
  return { entry, progress };
}

export async function setProgressValue(
  userId: string,
  cycleId: string,
  value: unknown,
  cycles: CycleRepository = cycleRepository,
  entries: ProgressRepository = progressRepository,
) {
  const cycle = await getCycle(userId, cycleId, cycles);
  if (cycle.status === "closed") throw new AppError("CONFLICT", "已关闭周期不能再更新进度");
  const body = assertRecord(value);
  const countRaw = body.currentCount ?? body.cumulativeCount ?? body.count;
  const amountRaw = body.currentAmount ?? body.cumulativeAmount ?? body.amount;
  const count = countRaw === undefined ? undefined : nonNegativeInteger(countRaw, "currentCount");
  const amount = amountRaw === undefined ? undefined : nonNegativeNumber(amountRaw, "currentAmount");
  if (count === undefined && amount === undefined) {
    throw new AppError("VALIDATION_ERROR", "currentCount 或 currentAmount 至少提供一项");
  }
  const all = await entries.list(userId, cycleId);
  const current = all.reduce(
    (sum, item) => applyProgressEntry(sum, { count: item.countDelta, amount: item.amountDelta }),
    { count: 0, amount: 0 },
  );
  const countDelta = count === undefined ? 0 : count - current.count;
  const amountDelta = amount === undefined ? 0 : Number((amount - current.amount).toFixed(2));
  const progress = calculateProgress(
    { type: cycle.waiveRuleType, targetCount: cycle.targetCount, targetAmount: cycle.targetAmount },
    { count: count ?? current.count, amount: amount ?? current.amount },
  );
  if (countDelta === 0 && amountDelta === 0) {
    return { entry: null, progress, current: { count: count ?? current.count, amount: amount ?? current.amount } };
  }
  const entry = await entries.add({
    userId,
    cardId: cycle.cardId,
    cycleId,
    entryDate: body.entryDate === undefined ? formatISODate(new Date()) : assertISODate(body.entryDate, "entryDate"),
    countDelta,
    amountDelta,
    entryType: "correction",
    note: body.note === undefined ? "累计值调整" : optionalString(body.note, "note", 500),
  });
  const next = applyProgressEntry(current, { count: countDelta, amount: amountDelta });
  const nextProgress = calculateProgress(
    { type: cycle.waiveRuleType, targetCount: cycle.targetCount, targetAmount: cycle.targetAmount },
    next,
  );
  if (nextProgress.qualified && cycle.status === "open") await cycles.save({ ...cycle, status: "qualified" });
  if (!nextProgress.qualified && cycle.status === "qualified") await cycles.save({ ...cycle, status: "open" });
  await recordAudit({
    userId,
    actorType: "user",
    actorId: userId,
    action: "progress.value_set",
    entityType: "progress_entry",
    entityId: entry.id,
    metadata: { cycleId, countDelta, amountDelta },
  });
  return { entry, progress: nextProgress, current: next };
}

export async function editProgressEntry(
  userId: string,
  cycleId: string,
  entryId: string,
  value: unknown,
  cycles: CycleRepository = cycleRepository,
  entries: ProgressRepository = progressRepository,
) {
  const cycle = await getCycle(userId, cycleId, cycles);
  if (cycle.status === "closed") throw new AppError("CONFLICT", "已关闭周期不能再编辑进度");
  const existing = await entries.get(userId, cycleId, entryId);
  if (!existing) throw new AppError("NOT_FOUND", "进度记录不存在");
  if (existing.entryType === "reversal" || existing.reversedAt) throw new AppError("CONFLICT", "撤销或已撤销记录不能编辑");
  const body = assertRecord(value);
  const entryDate = body.entryDate === undefined ? existing.entryDate : assertISODate(body.entryDate, "entryDate");
  const countDelta = body.countDelta === undefined ? existing.countDelta : nonNegativeInteger(body.countDelta, "countDelta");
  const amountDelta = body.amountDelta === undefined ? existing.amountDelta : nonNegativeNumber(body.amountDelta, "amountDelta");
  if (countDelta === 0 && amountDelta === 0) throw new AppError("VALIDATION_ERROR", "次数或金额增量至少有一项大于 0");
  const note = body.note === undefined ? existing.note : optionalString(body.note, "note", 500);
  const entry = await entries.update(userId, cycleId, entryId, { entryDate, countDelta, amountDelta, note });
  if (!entry) throw new AppError("CONFLICT", "该进度记录已经不存在");
  const all = await entries.list(userId, cycleId);
  const valueNow = all.reduce((sum, item) => applyProgressEntry(sum, { count: item.countDelta, amount: item.amountDelta }), { count: 0, amount: 0 });
  const progress = calculateProgress({ type: cycle.waiveRuleType, targetCount: cycle.targetCount, targetAmount: cycle.targetAmount }, valueNow);
  if (progress.qualified && cycle.status === "open") await cycles.save({ ...cycle, status: "qualified" });
  if (!progress.qualified && cycle.status === "qualified") await cycles.save({ ...cycle, status: "open" });
  await recordAudit({
    userId,
    actorType: "user",
    actorId: userId,
    action: "progress.updated",
    entityType: "progress_entry",
    entityId: entry.id,
    metadata: { cycleId, countDelta, amountDelta },
  });
  return { entry, progress };
}

export async function reverseProgressEntry(
  userId: string,
  cycleId: string,
  entryId: string,
  value: unknown,
  cycles: CycleRepository = cycleRepository,
  entries: ProgressRepository = progressRepository,
) {
  const cycle = await getCycle(userId, cycleId, cycles);
  if (cycle.status === "closed") throw new AppError("CONFLICT", "已关闭周期不能再撤销进度");
  const entry = await entries.get(userId, cycleId, entryId);
  if (!entry) throw new AppError("NOT_FOUND", "进度记录不存在");
  if (entry.entryType === "reversal" || entry.reversedAt) {
    throw new AppError("CONFLICT", "撤销记录不能再次撤销");
  }
  const body = assertRecord(value);
  const reversedEntry = {
    userId,
    cardId: cycle.cardId,
    cycleId,
    entryDate: body.entryDate === undefined ? formatISODate(new Date()) : assertISODate(body.entryDate, "entryDate"),
    countDelta: -entry.countDelta,
    amountDelta: -entry.amountDelta,
    note: body.note === undefined ? "撤销记录" : typeof body.note === "string" ? body.note : undefined,
    entryType: "reversal" as const,
  };
  const all = await entries.list(userId, cycleId);
  const valueNow = [...all, reversedEntry].reduce((sum, item) => applyProgressEntry(sum, { count: item.countDelta, amount: item.amountDelta }), { count: 0, amount: 0 });
  const progress = calculateProgress({ type: cycle.waiveRuleType, targetCount: cycle.targetCount, targetAmount: cycle.targetAmount }, valueNow);
  const marked = await entries.markReversed(userId, cycleId, entryId);
  if (!marked) throw new AppError("CONFLICT", "该进度记录已经撤销");
  const reversed = await entries.add(reversedEntry);
  if (!progress.qualified && cycle.status === "qualified") {
    await cycles.save({ ...cycle, status: "open" });
  }
  await recordAudit({
    userId,
    actorType: "user",
    actorId: userId,
    action: "progress.reversed",
    entityType: "progress_entry",
    entityId: entryId,
    metadata: { cycleId, reversalEntryId: reversed.id },
  });
  return { reversedEntry: reversed, progress };
}

export async function getCycleProgress(userId: string, cycleId: string, cycles: CycleRepository = cycleRepository, entries: ProgressRepository = progressRepository) { const cycle = await getCycle(userId, cycleId, cycles); const all = await entries.list(userId, cycleId); const value = all.reduce((sum, item) => applyProgressEntry(sum, { count: item.countDelta, amount: item.amountDelta }), { count: 0, amount: 0 }); return { cycle, entries: all, progress: calculateProgress({ type: cycle.waiveRuleType, targetCount: cycle.targetCount, targetAmount: cycle.targetAmount }, value) }; }
