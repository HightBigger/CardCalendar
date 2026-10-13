"use client";
import type { ReactNode } from "react";
export function QueryState({ loading, error, retry, hasData, children, label = "内容" }: { loading?: boolean; error?: Error; retry: () => unknown; hasData: boolean; children?: ReactNode; label?: string }) {
  return <>
    {loading && <p className="loading-inline" role="status">{hasData ? "正在更新" : "正在加载"}{label}…</p>}
    {error && <div className="form-error" role="alert">{label}暂时无法加载：{error.message} <button className="text-button" onClick={() => retry()}>重试</button></div>}
    {hasData && children}
  </>;
}
