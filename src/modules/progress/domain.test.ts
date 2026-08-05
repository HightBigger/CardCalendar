import { describe, expect, it } from "vitest";
import { applyProgressEntry, calculateProgress } from "./domain";

describe("progress", () => {
  it("uses the lower completion for count-and-amount rules", () => { expect(calculateProgress({ type: "count_and_amount", targetCount: 10, targetAmount: 100 }, { count: 10, amount: 20 })).toMatchObject({ percentage: 20, qualified: false, remainingCount: 0, remainingAmount: 80 }); });
  it("caps percentage and reports qualified", () => { expect(calculateProgress({ type: "count", targetCount: 2 }, { count: 3, amount: 0 })).toMatchObject({ percentage: 100, qualified: true }); });
  it("uses the count target for count-only rules", () => { expect(calculateProgress({ type: "count", targetCount: 10 }, { count: 4, amount: 0 })).toMatchObject({ percentage: 40, qualified: false }); });
  it("keeps two decimal places when adding amounts", () => { expect(applyProgressEntry({ count: 1, amount: 0.1 }, { count: 2, amount: 0.2 })).toEqual({ count: 3, amount: 0.3 }); });
});
