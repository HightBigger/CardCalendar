import { describe, expect, it } from "vitest";
import { planBoundaries, planSchema } from "./period-plans";
import { snapshotProgress, targetReached } from "./catalog-progress";

const base = {
  type: "month" as const,
  startOn: "2028-02-15",
  endOn: "2028-04-10",
  timezone: "America/New_York",
  partialPolicy: "full_target" as const,
  periods: [],
  affectedPeriodIds: [],
  targetKind: "count_and_amount" as const,
  targetCount: 2,
  targetAmount: "100.00",
  currency: "CNY",
  ruleVersionId: "00000000-0000-4000-8000-000000000001",
  participationVersion: 1,
};

describe("finite plan boundaries and frozen monetary rules", () => {
  it("uses local month boundaries across leap day and does not truncate after 120 periods", () => {
    expect(planBoundaries(planSchema.parse(base))).toEqual([
      {periodKey:"2028-02",startOn:"2028-02-15",endOn:"2028-02-29"},
      {periodKey:"2028-03",startOn:"2028-03-01",endOn:"2028-03-31"},
      {periodKey:"2028-04",startOn:"2028-04-01",endOn:"2028-04-10"},
    ]);
    const long = planBoundaries(planSchema.parse({...base,startOn:"2027-01-01",endOn:"2037-12-31"}));
    expect(long).toHaveLength(132);
    expect(long.at(-1)?.endOn).toBe("2037-12-31");
  });

  it("requires explicit billing/custom boundaries and exact once coverage", () => {
    for (const type of ["billing", "custom"] as const) {
      expect(() => planBoundaries(planSchema.parse({...base,type}))).toThrow();
      expect(planBoundaries(planSchema.parse({...base,type,periods:[
        {startOn:"2028-02-15",endOn:"2028-03-14"},
        {startOn:"2028-03-15",endOn:"2028-04-10"},
      ]}))).toHaveLength(2);
      expect(() => planBoundaries(planSchema.parse({...base,type,periods:[
        {startOn:"2028-02-15",endOn:"2028-03-15"},
        {startOn:"2028-03-15",endOn:"2028-04-10"},
      ]}))).toThrow("重叠");
    }
    expect(planBoundaries(planSchema.parse({...base,type:"once"}))).toEqual([
      {periodKey:"once",startOn:base.startOn,endOn:base.endOn},
    ]);
    expect(() => planBoundaries(planSchema.parse({...base,type:"once",periods:[{startOn:base.startOn,endOn:"2028-04-09"}]}))).toThrow("完整活动期");
  });

  it("keeps AND/OR and cents exact without carrying excess into another period", () => {
    const target={kind:"count_and_amount" as const,count:2,amount:"999999999999.99",currency:"CNY",rulesText:""};
    expect(targetReached(target,1,"999999999999.99")).toBe(false);
    expect(targetReached({...target,kind:"count_or_amount"},1,"999999999999.99")).toBe(true);
    expect(targetReached(target,2,"999999999999.98")).toBe(false);
    expect(targetReached(target,2,"999999999999.99")).toBe(true);
    expect(snapshotProgress([
      {stage:"occurred",count:2,amount:"100.01"},
      {stage:"posted",count:1,amount:"50.00"},
    ],"posted")).toMatchObject({count:1,amount:"50.00",pendingCount:1,pendingAmount:"50.01"});
  });
});
