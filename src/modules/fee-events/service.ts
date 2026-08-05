import { AppError } from "../../shared/errors";
import { assertISODate } from "../../shared/time";
import { assertRecord, nonNegativeNumber, optionalString } from "../../shared/validation";
import { FeeEventStatusInput, validateFeeEventStatus } from "./domain";
import { feeEventRepository, FeeEventRepository } from "./repository";
import { reminderRepository } from "../reminders";

export async function listFeeEvents(userId: string, range?: { from?: string; to?: string }, repository: FeeEventRepository = feeEventRepository) { return repository.list(userId, { from: range?.from ? assertISODate(range.from, "from") : undefined, to: range?.to ? assertISODate(range.to, "to") : undefined }); }
export async function getFeeEvent(userId: string, id: string, repository: FeeEventRepository = feeEventRepository) { const event = await repository.get(userId, id); if (!event) throw new AppError("NOT_FOUND", "年费事件不存在"); return event; }
export function parseStatusInput(value: unknown): FeeEventStatusInput { const body = assertRecord(value); const status = body.status; if (typeof status !== "string") throw new AppError("VALIDATION_ERROR", "status 为必填项"); const input: FeeEventStatusInput = { status: status as FeeEventStatusInput["status"], actualAmount: body.actualAmount === undefined ? undefined : nonNegativeNumber(body.actualAmount, "actualAmount"), occurredOn: body.occurredOn === undefined ? undefined : assertISODate(body.occurredOn, "occurredOn"), notes: optionalString(body.notes, "notes", 2000) }; return validateFeeEventStatus(input); }
export async function updateFeeEventStatus(userId: string, id: string, value: unknown, repository: FeeEventRepository = feeEventRepository) {
  const event = await repository.updateStatus(userId, id, parseStatusInput(value));
  if (!event) throw new AppError("NOT_FOUND", "年费事件不存在");
  if (event.status !== "pending") {
    const linked = await reminderRepository.list(userId, false);
    await Promise.all(
      linked
        .filter((reminder) => reminder.feeEventId === event.id && (reminder.status === "pending" || reminder.status === "snoozed"))
        .map((reminder) => reminderRepository.save({ ...reminder, status: "cancelled" })),
    );
  }
  return event;
}
