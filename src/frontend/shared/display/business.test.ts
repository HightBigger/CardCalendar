import { describe, expect, it } from "vitest";
import { businessDate, displayAmount, safeOfficialUrl } from "./business";
import { fromDateDraft, tomorrowDate, validDate } from "./date-draft";
describe("business date and amount display", () => {
  it("preserves an official date and its timezone instead of converting UTC midnight", () => {
    expect(businessDate({ kind: "date", value: "2026-10-31", timezone: "Asia/Shanghai" }, "America/Los_Angeles")).toBe("2026-10-31（Asia/Shanghai）");
    expect(businessDate({ kind: "unknown", reason: "工作日规则未知" }, "Asia/Shanghai")).toContain("工作日规则未知");
    expect(displayAmount(null, "CNY")).toBe("金额待核对");
  });
  it("converts input in the account timezone regardless of browser timezone", () => {
    expect(fromDateDraft({ kind: "instant", value: "2026-10-09T10:00" }, "Asia/Shanghai")).toEqual({ kind: "instant", value: "2026-10-09T02:00:00.000Z", timezone: "Asia/Shanghai" });
  });
  it("rejects nonexistent DST times and invalid date boundaries", () => {
    expect(() => fromDateDraft({ kind: "instant", value: "2026-03-08T02:30" }, "America/New_York")).toThrow();
    expect(validDate("2026-02-30")).toBe(false); expect(validDate("2028-02-29")).toBe(true);
    expect(tomorrowDate("2026-03-08T05:30:00Z", "America/New_York")).toEqual({ kind: "date", value: "2026-03-09", timezone: "America/New_York" });
  });
  it("opens only valid HTTPS links without embedded credentials", () => {
    expect(safeOfficialUrl("javascript:alert(1)")).toBeUndefined(); expect(safeOfficialUrl("https://password@example.com")).toBeUndefined(); expect(safeOfficialUrl("https://example.com/path")).toBe("https://example.com/path");
  });
});
