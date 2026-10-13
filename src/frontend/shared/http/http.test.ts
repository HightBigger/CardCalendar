import { afterEach, describe, expect, it, vi } from "vitest";
import { apiCommand, apiJson, subscribeUnauthorized } from "./index";
import { todosApi } from "../../features/todos/api/todos-api";
import { spendTasksApi } from "../../features/spend-tasks/api/spend-tasks-api";
import { createFixtureWorkbench } from "../../dev/fixtures";
afterEach(() => vi.unstubAllGlobals());
describe("HTTP adapters and committed/queued contracts", () => {
  it("distinguishes a 202 job from a saved entity and preserves metadata", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: { jobId: "job-1", status: "queued" }, meta: { serverNow: "2026-10-09T00:00:00Z" } }, { status: 202 })));
    const result = await apiCommand("/api/v1/periods", {}, "intent-1"); expect(result).toMatchObject({ kind: "queued", jobId: "job-1" });
    await expect(apiJson("/api/v1/periods")).rejects.toMatchObject({ code: "QUEUED_RESULT" });
  });
  it("sends expectedVersion for updates and never invents it for a new custom todo", async () => {
    const fetcher = vi.fn(async (_path: string, _options: RequestInit) => Response.json({ data: { action: {} } })); vi.stubGlobal("fetch", fetcher);
    const draft = { title: "核对奖励", description: "", priority: "normal" as const, deadline: { kind: "unknown" as const, reason: "未定" }, plannedFor: { kind: "unknown" as const, reason: "未定" } };
    await todosApi.create(draft, "stable-key", new AbortController().signal);
    let options = fetcher.mock.calls[0][1] as RequestInit; expect(JSON.parse(String(options.body))).not.toHaveProperty("expectedVersion"); expect(new Headers(options.headers).get("Idempotency-Key")).toBe("stable-key");
    await todosApi.update("todo-a", { ...draft, expectedVersion: 4 }, "stable-update", new AbortController().signal);
    options = fetcher.mock.calls[1][1] as RequestInit; expect(JSON.parse(String(options.body))).toMatchObject({ expectedVersion: 4 });
  });
  it("links an existing consumption fact without copying its amount", async () => {
    const fetcher = vi.fn(async (_path: string, _options: RequestInit) => Response.json({ data: {} })); vi.stubGlobal("fetch", fetcher);
    const task = createFixtureWorkbench("entries").state.tasks["fixture-task-10"];
    await spendTasksApi.link(task, "existing-fact", "link-key", new AbortController().signal);
    const options = fetcher.mock.calls[0][1] as RequestInit; const body = JSON.parse(String(options.body)); expect(body).toEqual({ spendFactId: "existing-fact", expectedVersion: task.version }); expect(body).not.toHaveProperty("amount");
  });
  it("ignores authentication failure from an already cancelled old session request", async () => {
    const listener = vi.fn(); const unsubscribe = subscribeUnauthorized(listener); const controller = new AbortController(); controller.abort();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { message: "旧会话" } }, { status: 401 })));
    await expect(apiJson("/api/v1/me", { signal: controller.signal })).rejects.toMatchObject({ status: 401 }); expect(listener).not.toHaveBeenCalled(); unsubscribe();
  });
});
