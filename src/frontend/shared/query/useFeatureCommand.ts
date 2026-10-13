"use client";
import { useEffect, useRef, useState } from "react";
import type { CommandResult, Resource } from "../../../contracts/workbench";
import { ApiError } from "../http";
import { IntentKeys } from "./intent";
import { RequestSequence } from "./request-sequence";
import { invalidate } from "./invalidation";
export function useFeatureCommand(scope: string, resources: readonly Resource[], queryKey = "") {
  const identity = JSON.stringify([scope, queryKey]);
  const current = useRef(identity); current.current = identity;
  const keys = useRef(new IntentKeys());
  const sequence = useRef(new RequestSequence());
  const busyRef = useRef(false);
  const [state, setState] = useState<{ identity: string; busy: boolean; error?: string }>({ identity, busy: false });
  useEffect(() => { keys.current.clear(); busyRef.current = false; return () => sequence.current.cancel(); }, [scope]);
  useEffect(() => { sequence.current.cancel(); busyRef.current = false; return () => sequence.current.cancel(); }, [identity]);
  async function run<T>(path: string, payload: unknown, send: (key: string, signal: AbortSignal) => Promise<CommandResult<T>>): Promise<CommandResult<T> | undefined> {
    if (busyRef.current) return;
    busyRef.current = true;
    const request = sequence.current.begin();
    setState({ identity, busy: true });
    try {
      const result = await send(keys.current.key(path, payload), request.signal);
      if (!request.current() || current.current !== identity) return;
      if (result.kind === "committed") { keys.current.committed(path, payload); invalidate(scope, resources); }
      setState({ identity, busy: false });
      return result;
    } catch (error) {
      if (!request.current() || current.current !== identity) return;
      const conflict = error instanceof ApiError && error.status === 409;
      if (conflict) invalidate(scope, resources);
      setState({ identity, busy: false, error: conflict ? "此记录已更新。草稿已保留，请核对最新版本后重新提交。" : error instanceof Error ? error.message : "操作失败，可重试" });
    } finally { if (request.current() && current.current === identity) busyRef.current = false; }
  }
  return { run, busy: state.identity === identity && state.busy, error: state.identity === identity ? state.error : undefined, clearError: () => setState({ identity, busy: false }) };
}
