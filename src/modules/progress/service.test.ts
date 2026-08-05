import { describe, expect, it } from "vitest";
import { InMemoryCycleRepository } from "../cycles/repository";
import type { OwnedFeeCycle } from "../cycles/repository";
import { InMemoryProgressRepository } from "./repository";
import { editProgressEntry, reverseProgressEntry } from "./service";

describe("progress service", () => {
  it("reverses a manual entry and rejects reversing the reversal", async () => {
    const cycles = new InMemoryCycleRepository();
    const entries = new InMemoryProgressRepository();
    const cycle: OwnedFeeCycle = {
      id: "cycle-1",
      userId: "user-1",
      cardId: "card-1",
      periodStart: "2026-01-01",
      periodEnd: "2027-01-01",
      feeDueDate: "2027-01-01",
      waiveRuleType: "count",
      targetCount: 10,
      status: "open",
    };
    await cycles.save(cycle);
    const entry = await entries.add({
      userId: "user-1",
      cardId: "card-1",
      cycleId: "cycle-1",
      entryDate: "2026-08-06",
      countDelta: 4,
      amountDelta: 0,
      note: "manual",
      entryType: "manual",
    });

    const result = await reverseProgressEntry(
      "user-1",
      "cycle-1",
      entry.id,
      { note: "undo" },
      cycles,
      entries,
    );
    expect(result.reversedEntry.countDelta).toBe(-4);
    expect(result.progress.count).toBe(0);

    await expect(
      reverseProgressEntry(
        "user-1",
        "cycle-1",
        result.reversedEntry.id,
        {},
        cycles,
        entries,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("edits a manual entry and recalculates progress and cycle status", async () => {
    const cycles = new InMemoryCycleRepository();
    const entries = new InMemoryProgressRepository();
    const cycle: OwnedFeeCycle = {
      id: "cycle-1",
      userId: "user-1",
      cardId: "card-1",
      periodStart: "2026-01-01",
      periodEnd: "2027-01-01",
      feeDueDate: "2027-01-01",
      waiveRuleType: "count",
      targetCount: 10,
      status: "open",
    };
    await cycles.save(cycle);
    const entry = await entries.add({
      userId: "user-1",
      cardId: "card-1",
      cycleId: "cycle-1",
      entryDate: "2026-08-06",
      countDelta: 4,
      amountDelta: 0,
      note: "manual",
      entryType: "manual",
    });

    const qualified = await editProgressEntry(
      "user-1",
      "cycle-1",
      entry.id,
      { countDelta: 10, note: "corrected" },
      cycles,
      entries,
    );
    expect(qualified.entry.countDelta).toBe(10);
    expect(qualified.entry.note).toBe("corrected");
    expect(qualified.progress.qualified).toBe(true);
    expect((await cycles.get("user-1", "cycle-1"))?.status).toBe("qualified");

    const reopened = await editProgressEntry(
      "user-1",
      "cycle-1",
      entry.id,
      { countDelta: 3, entryDate: "2026-08-07" },
      cycles,
      entries,
    );
    expect(reopened.entry.countDelta).toBe(3);
    expect(reopened.entry.entryDate).toBe("2026-08-07");
    expect(reopened.progress.count).toBe(3);
    expect(reopened.progress.qualified).toBe(false);
    expect((await cycles.get("user-1", "cycle-1"))?.status).toBe("open");
  });

  it("rejects editing reversal records", async () => {
    const cycles = new InMemoryCycleRepository();
    const entries = new InMemoryProgressRepository();
    const cycle: OwnedFeeCycle = {
      id: "cycle-1",
      userId: "user-1",
      cardId: "card-1",
      periodStart: "2026-01-01",
      periodEnd: "2027-01-01",
      feeDueDate: "2027-01-01",
      waiveRuleType: "count",
      targetCount: 10,
      status: "open",
    };
    await cycles.save(cycle);
    const entry = await entries.add({
      userId: "user-1",
      cardId: "card-1",
      cycleId: "cycle-1",
      entryDate: "2026-08-06",
      countDelta: 4,
      amountDelta: 0,
      note: "manual",
      entryType: "manual",
    });
    const reversed = await reverseProgressEntry("user-1", "cycle-1", entry.id, {}, cycles, entries);

    await expect(
      editProgressEntry("user-1", "cycle-1", reversed.reversedEntry.id, {}, cycles, entries),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
