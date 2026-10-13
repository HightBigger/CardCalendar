"use client";
import type { PrimaryAction } from "../../../contracts/workbench";
import type { WorkbenchPorts } from "../../app/ports";
import { useSession } from "../../app/SessionBoundary";
import { TodoAttention, useTodoWorkspaceController } from "../../features/todos";

export function RecentTodos({ ports, onPrimary, onAll }: { ports?: WorkbenchPorts; onPrimary: (action: PrimaryAction) => void; onAll: () => void }) {
  const session = useSession();
  const c = useTodoWorkspaceController(session.scope, session.profile.timezone, ports?.todos, undefined, "attention");
  return <TodoAttention controller={c} timezone={session.profile.timezone} onPrimary={onPrimary} onAll={onAll} />;
}
