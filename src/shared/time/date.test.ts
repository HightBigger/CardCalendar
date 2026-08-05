import { describe, expect, it } from "vitest";
import { addMonths, addYears, daysBetween, isISODate, localDateTimeToInstant, todayInTimezone } from "./date";

describe("shared time", () => {
  it("validates calendar dates", () => { expect(isISODate("2024-02-29")).toBe(true); expect(isISODate("2025-02-29")).toBe(false); });
  it("clamps month and year boundaries", () => { expect(addYears("2024-02-29", 1)).toBe("2025-02-28"); expect(addMonths("2026-01-31", 1)).toBe("2026-02-28"); });
  it("uses date-only arithmetic", () => { expect(daysBetween("2026-03-01", "2026-03-31")).toBe(30); });
  it("converts local time and derives local today", () => { expect(localDateTimeToInstant("2026-08-05", 9, "Asia/Shanghai").toISOString()).toBe("2026-08-05T01:00:00.000Z"); expect(todayInTimezone("Asia/Shanghai", new Date("2026-08-04T16:30:00.000Z"))).toBe("2026-08-05"); });
});

