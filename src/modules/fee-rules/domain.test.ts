import { describe, expect, it } from "vitest";
import { feeDateForYear, feeDueDateOnOrAfter, generateFeeDates } from "./domain";

describe("fee rules", () => {
  it("clamps invalid month-end dates", () => { expect(feeDateForYear(2, 29, 2025)).toBe("2025-02-28"); });
  it("keeps leap-day anniversaries based on the opening date", () => { expect(feeDueDateOnOrAfter({ cycleType: "anniversary", openedOn: "2024-02-29", nextFeeDate: "2025-02-28" }, "2028-02-29")).toBe("2028-02-29"); });
  it("generates only annual events inside the horizon", () => { expect(generateFeeDates({ cycleType: "fixed_date", feeMonth: 5, feeDay: 31, nextFeeDate: "2026-05-31" }, "2026-01-01", 12)).toEqual(["2026-05-31"]); });
});

