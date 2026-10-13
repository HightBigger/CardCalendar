import type {
  CatalogContent,
  CatalogTarget,
} from "../../contracts/activity-catalog";
import { minor, positiveDifference } from "../spend-task/money";
export type Observation = { stage: string; count: number; amount: string };
// A snapshot replaces a cumulative value; snapshots and milestones are never summed.
// Earlier milestones describe an estimated total, so only its excess over confirmed
// progress is pending. Later milestones satisfy an earlier frozen cutoff basis.
export function snapshotProgress(
  observations: Observation[],
  basis: CatalogContent["periodTemplate"]["countingBasis"],
) {
  const rank: Record<string, number> = { occurred: 0, posted: 1, settled: 2 };
  const knownBasis = basis in rank;
  const newest = [...observations].reverse();
  const confirmed = knownBasis
    ? newest.find((o) => o.stage in rank && rank[o.stage] >= rank[basis])
    : undefined;
  const estimated = knownBasis
    ? newest.find((o) => o.stage in rank && rank[o.stage] < rank[basis])
    : undefined;
  const latest = observations.at(-1);
  const unknown = !knownBasis || latest?.stage === "unknown";
  const count = unknown ? 0 : (confirmed?.count ?? 0);
  const amount = unknown ? "0.00" : (confirmed?.amount ?? "0.00");
  return {
    count,
    amount,
    unknown,
    pendingCount: unknown ? 0 : Math.max(0, (estimated?.count ?? 0) - count),
    pendingAmount: unknown
      ? "0.00"
      : positiveDifference(estimated?.amount ?? "0.00",amount),
  };
}
export function targetReached(
  target: CatalogTarget,
  count: number,
  amount: string,
) {
  const c = target.count !== null && count >= target.count;
  const a = target.amount !== null && minor(amount) >= minor(target.amount);
  return target.kind === "count"
    ? c
    : target.kind === "amount"
      ? a
      : target.kind === "count_or_amount"
        ? c || a
        : target.kind === "count_and_amount"
          ? c && a
          : false;
}
