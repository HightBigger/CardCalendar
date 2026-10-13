import { notFound } from "next/navigation";
import { WorkbenchEntry } from "../../../src/frontend/pages/workbench/Workbench";
import { workbenchGates } from "../../../src/frontend/app/feature-gates";
export default function Page() { const gates=workbenchGates(); if (!gates.activities) notFound(); return <WorkbenchEntry gates={gates} initialView="activities" />; }
