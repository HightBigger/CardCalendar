import { Suspense } from "react";
import { notFound } from "next/navigation";
import { DevWorkbench } from "../../../src/frontend/dev/DevWorkbench";
export default function DevWorkbenchPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <Suspense fallback={<main className="loading-page">正在加载验收示例…</main>}><DevWorkbench /></Suspense>;
}
