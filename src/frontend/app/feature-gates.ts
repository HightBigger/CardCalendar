import type { FeatureGates } from "../../contracts/feature-gates";
// Server route configuration only; never import into a browser feature.
export function workbenchGates(): FeatureGates {
  const todos = process.env.FEATURE_TODOS === "true";
  const activities = todos && process.env.FEATURE_ACTIVITIES === "true";
  return { todos, activities, activityPeriods: activities && process.env.FEATURE_ACTIVITY_PERIODS === "true" };
}
