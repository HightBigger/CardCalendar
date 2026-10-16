import type { ReactNode } from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { WorkspaceFrame } from "@/frontend/app/WorkspaceFrame";
import { workbenchGates } from "@/frontend/app/feature-gates";

export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  const path = (await headers()).get("x-cardcalendar-pathname") ?? "/";
  const gates = workbenchGates();
  const within = (prefix: string) => path === prefix || path.startsWith(prefix + "/");
  // Reject closed routes before the client session layer can stream a loading page.
  if ((within("/todos") && !gates.todos) ||
      (within("/activities") && !gates.activities) ||
      (within("/bank-activities") && process.env.FEATURE_CATALOG_READ !== "true") ||
      (within("/admin/bank-activities") && process.env.FEATURE_CATALOG_MANAGE !== "true")) notFound();
  return <WorkspaceFrame gates={gates}>{children}</WorkspaceFrame>;
}
