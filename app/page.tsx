import { WorkbenchEntry } from "../src/frontend/pages/workbench/Workbench";
import { workbenchGates } from "../src/frontend/app/feature-gates";
export default function HomePage() { return <WorkbenchEntry gates={workbenchGates()} />; }
