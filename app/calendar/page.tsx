import { redirect } from "next/navigation";
import { WorkbenchEntry } from "../../src/frontend/pages/workbench/Workbench";
import { workbenchGates } from "../../src/frontend/app/feature-gates";
export default function Page() { const gates = workbenchGates(); if (gates.todos) redirect("/todos?view=calendar&types=annual_fee"); return <WorkbenchEntry gates={gates} initialView="calendar" />; }
