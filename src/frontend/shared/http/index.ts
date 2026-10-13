import type { CommandResult, Envelope, QueryMeta } from "../../../contracts/workbench";

export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly code?: string, public readonly details?: unknown) {
    super(message);
  }
}
const authListeners = new Set<() => void>();
export function subscribeUnauthorized(listener: () => void) {
  authListeners.add(listener);
  return () => { authListeners.delete(listener); };
}
async function request(path: string, options: RequestInit) {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(path, { ...options, credentials: "same-origin", cache: "no-store", headers });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && !options.signal?.aborted && !path.startsWith("/api/v1/auth/")) authListeners.forEach((listener) => listener());
    throw new ApiError(body?.error?.message ?? "请求失败，请稍后重试", response.status, body?.error?.code, body?.error?.details);
  }
  if (!body || !("data" in body)) throw new ApiError("响应格式不完整，请重试", 502, "INVALID_RESPONSE");
  return { body: body as Envelope<unknown>, status: response.status };
}
export async function apiJson<T>(path: string, options: RequestInit = {}): Promise<Envelope<T>> {
  const { body, status } = await request(path, options);
  if (status === 202) throw new ApiError("命令已排队，不能作为已保存结果读取", 202, "QUEUED_RESULT");
  return body as Envelope<T>;
}
export async function apiCommand<T>(path: string, payload: unknown, key: string, options: RequestInit = {}): Promise<CommandResult<T>> {
  const headers = new Headers(options.headers);
  headers.set("Idempotency-Key", key);
  const { body, status } = await request(path, { method: "POST", ...options, headers, body: JSON.stringify(payload) });
  if (status === 202) {
    const queued = body.data as { jobId?: string; status?: string };
    if (!queued.jobId || queued.status !== "queued") throw new ApiError("后台任务响应不完整", 502, "INVALID_JOB");
    return { kind: "queued", jobId: queued.jobId, status: "queued", meta: body.meta as QueryMeta | undefined };
  }
  return { kind: "committed", data: body.data as T, meta: body.meta };
}
