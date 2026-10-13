import { AppError } from "../../shared/errors";

export function workbenchWriteEnabled(pathname: string) {
  if (pathname.startsWith("/api/v1/todos/" ) || pathname === "/api/v1/todos")
    return process.env.FEATURE_TODOS === "true";
  const activities = process.env.FEATURE_TODOS === "true" && process.env.FEATURE_ACTIVITIES === "true";
  if (!activities) return false;
  if (/\/period-plans$|\/spend-entries$|\/evaluations$|\/milestones$|\/reversals$|\/overall-tasks$|\/overall-target$/.test(pathname))
    return process.env.FEATURE_ACTIVITY_PERIODS === "true";
  return true;
}

export function requireWorkbenchWrite(pathname: string) {
  if (!workbenchWriteEnabled(pathname))
    throw new AppError("NOT_FOUND", "私人工作台写入功能尚未开放");
}
