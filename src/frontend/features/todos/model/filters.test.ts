import { describe, expect, it } from "vitest";
import { monthCells, parseTodoFilters, todoParams, todoUrl } from "./filters";
describe("shared list/calendar URL filters", () => {
  it("round-trips all common filters while switching view and retaining the date range", () => {
    const filters = parseTodoFilters(new URLSearchParams("cardIds=b,a&types=reward_claim,annual_fee&status=ignored&q=返现&from=2026-10-01&to=2027-01-20&includeUndated=false&month=2027-01"), "2026-10");
    const switched = parseTodoFilters(new URLSearchParams(todoUrl({ ...filters, view: "calendar" }).slice(1)), "2026-10");
    expect(switched).toEqual({ ...filters, view: "calendar" });
    expect(todoParams(filters).get("month")).toBeNull(); expect(todoParams(switched, true).get("month")).toBe("2027-01");
  });
  it("normalizes invalid and duplicate values without fabricating a date", () => {
    const filters = parseTodoFilters(new URLSearchParams("cardIds=a,a&types=unknown,custom&from=2026-02-30&month=2026-13&status=bank_confirmed"), "2026-10");
    expect(filters.cardIds).toEqual(["a"]); expect(filters.types).toEqual(["custom"]); expect(filters.from).toBe(""); expect(filters.status).toBe("pending"); expect(filters.month).toBe("2026-10");
  });
  it("lays out calendar cells without using the host timezone", () => {
    const dates = monthCells("2026-10"); expect(dates.length).toBe(42); expect(dates[0]).toBe("2026-09-28"); expect(new Set(dates).size).toBe(42);
  });
});
