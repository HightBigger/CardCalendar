import { WorkbenchEntry } from "../../src/frontend/pages/workbench/Workbench";
import { workbenchGates } from "../../src/frontend/app/feature-gates";
export default function Page() { return <WorkbenchEntry gates={workbenchGates()} initialView="notifications" />; }
