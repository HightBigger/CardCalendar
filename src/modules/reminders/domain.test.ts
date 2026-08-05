import { describe, expect, it } from "vitest";
import { canTransitionReminder, reminderSchedule } from "./domain";

describe("reminders", () => {
  it("deduplicates offsets and schedules at local 09:00", () => { const schedules = reminderSchedule("2026-08-10", "Asia/Shanghai", [7, 1, 7]); expect(schedules.map((item) => item.daysBefore)).toEqual([7, 1]); expect(schedules[0].scheduledFor.toISOString()).toBe("2026-08-03T01:00:00.000Z"); });
  it("does not reopen terminal reminders", () => { expect(canTransitionReminder("completed", "snoozed")).toBe(false); expect(canTransitionReminder("pending", "completed")).toBe(true); });
});

