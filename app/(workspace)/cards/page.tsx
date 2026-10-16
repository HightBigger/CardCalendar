import { WorkbenchEntry } from "@/frontend/pages/workbench/Workbench";
import { workbenchGates } from "@/frontend/app/feature-gates";
export default function Page() { return <WorkbenchEntry gates={workbenchGates()} initialView="cards" />; }
