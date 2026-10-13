"use client";
import type { PrimaryAction } from "../../../contracts/workbench";
import { useSession } from "../../app/SessionBoundary";
import type { WorkbenchPorts } from "../../app/ports";
import { TodoWorkspace, useTodoWorkspaceController } from "../../features/todos";
export function TodosPage({ ports, onPrimary, onNotifications, defaultMonth }: { ports?: WorkbenchPorts; onPrimary: (action: PrimaryAction) => void; onNotifications: () => void; defaultMonth?: string }) {
  const session = useSession();
  const c = useTodoWorkspaceController(session.scope, session.profile.timezone, ports?.todos, defaultMonth);
  return <TodoWorkspace controller={c} timezone={session.profile.timezone} onPrimary={(action) => { if (action.kind === "detail" && !action.participationId) c.select(action.resourceId); else onPrimary(action); }} onNotifications={onNotifications} />;
}
