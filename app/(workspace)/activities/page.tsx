import { notFound } from "next/navigation";
import { WorkbenchEntry } from "@/frontend/pages/workbench/Workbench";
import { workbenchGates } from "@/frontend/app/feature-gates";
export default function Page() { const gates=workbenchGates(); if (!gates.activities) notFound(); return <WorkbenchEntry gates={gates} initialView="activities" />; }
