"use client";
import { ActivitiesPage } from "../activity-detail/ActivitiesPage";
import { TodosPage } from "../todos/TodosPage";
import { ActionDispatcher } from "../../app/ActionDispatcher";
import type { PrimaryAction } from "../../../contracts/workbench";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CatalogFrame } from "./CatalogFrame";
import { BankActivitiesPage } from "./BankActivitiesPage";
import { AdminCatalogPage } from "../catalog-admin/AdminCatalogPage";
// Rendering entry for isolated acceptance. All data still comes from real API adapters.
export function CatalogAcceptanceEntry() {
  return (
    <Suspense fallback={<p>正在加载验收页面…</p>}>
      <Content />
    </Suspense>
  );
}
function Content() {
  const [action, setAction] = useState<PrimaryAction | null>(null);
  const params = useSearchParams(),
    manage = params.get("manage") === "true",
    id = params.get("id") ?? undefined;
  return (
    <CatalogFrame
      manage={manage}
      gates={{ todos: true, activities: true, activityPeriods: false }}
    >
      {params.get("section") === "personal" ? (
        <ActivitiesPage
          initialId={id}
          gates={{ todos: true, activities: true, activityPeriods: false }}
          onPrimary={setAction}
        />
      ) : params.get("section") === "todos" ? (
        <TodosPage
          defaultMonth="2026-10"
          onPrimary={setAction}
          onNotifications={() => {}}
        />
      ) : manage ? (
        <AdminCatalogPage id={id} />
      ) : (
        <BankActivitiesPage id={id} />
      )}
      <ActionDispatcher action={action} onClose={() => setAction(null)} />
    </CatalogFrame>
  );
}
