"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Envelope, Resource } from "../../../contracts/workbench";
import { RequestSequence } from "./request-sequence";
import { subscribeInvalidation } from "./invalidation";

export function useRemoteQuery<T>({ scope, resource, queryKey = "", load, enabled = true, initial }: {
  scope: string; resource: Resource; queryKey?: string; load: (signal: AbortSignal) => Promise<Envelope<T>>; enabled?: boolean; initial?: Envelope<T>;
}) {
  const identity = JSON.stringify([scope, resource, queryKey]);
  const [state, setState] = useState<{ identity: string; result?: Envelope<T>; loading: boolean; error?: Error }>({ identity, result: initial, loading: !initial && enabled });
  const sequence = useRef(new RequestSequence());
  const loader = useRef(load);
  loader.current = load;
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const reload = useCallback(async () => {
    if (!enabled) return;
    const request = sequence.current.begin();
    setState((old) => ({ identity, result: old.identity === identity ? old.result : undefined, loading: true }));
    try {
      const result = await loader.current(request.signal);
      if (request.current() && currentIdentity.current === identity) setState({ identity, result, loading: false });
    } catch (error) {
      if (request.current() && currentIdentity.current === identity) setState((old) => ({ ...old, loading: false, error: error instanceof Error ? error : new Error("加载失败") }));
    }
  }, [identity, enabled]);
  useEffect(() => {
    if (!initial) void reload();
    return () => sequence.current.cancel();
    // initial is a seed, not a changing remote source.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload]);
  useEffect(() => subscribeInvalidation((event) => {
    if (event.scope === scope && event.resources.includes(resource)) void reload();
  }), [scope, resource, reload]);
  useEffect(() => {
    const onFocus = () => { void reload(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [reload]);
  const result = state.identity === identity && enabled ? state.result : undefined;
  useEffect(() => {
    const boundary = result?.meta?.nextBoundaryAt;
    if (!boundary) return;
    const delay = Math.min(2_147_483_647, Math.max(100, Date.parse(boundary) - Date.now()));
    if (!Number.isFinite(delay)) return;
    const timer = window.setTimeout(() => { void reload(); }, delay);
    return () => window.clearTimeout(timer);
  }, [result?.meta?.nextBoundaryAt, reload]);
  return { data: result?.data, meta: result?.meta, error: state.identity === identity ? state.error : undefined, loading: enabled && (state.identity !== identity || state.loading), refreshing: !!result && state.loading, reload };
}
