"use client";
import type { PrimaryAction } from "../../contracts/workbench";
import { useSession } from "./SessionBoundary";
import type { WorkbenchPorts } from "./ports";
import { useSpendTaskController, SpendTaskPanel } from "../features/spend-tasks";
import { useRewardController, RewardPanel } from "../features/rewards";
import { useActivitiesController, EnrollmentForm } from "../features/activities";
import { ModalShell, QueryState } from "../shared/ui";

function TaskAction({ action, ports }: { action: PrimaryAction; ports?: WorkbenchPorts }) {
  const session = useSession(); const controller = useSpendTaskController(session.scope, action.resourceId, ports?.spendTasks);
  return <SpendTaskPanel controller={controller} initialAction={action.kind} />;
}
function RewardAction({ action, ports, onPrimary }: { action: PrimaryAction; ports?: WorkbenchPorts; onPrimary?: (action: PrimaryAction) => void }) {
  const session = useSession(); const controller = useRewardController(session.scope, action.participationId!, action.resourceId, ports?.rewards);
  return <RewardPanel controller={controller} timezone={session.profile.timezone} initialAction={action.kind} onPrimary={onPrimary} />;
}
function EnrollmentAction({ action, ports }: { action: PrimaryAction; ports?: WorkbenchPorts }) {
  const session = useSession(); const c = useActivitiesController(session.scope, session.profile.timezone, { cardId: "", state: "all", q: "" }, action.resourceId, ports?.activities);
  return <QueryState {...c.detail} hasData={!!c.detail.data} retry={c.detail.reload} label="报名核对">{c.detail.data && <EnrollmentForm detail={c.detail.data} busy={c.command.busy} error={c.command.error} onSave={(scope, kind, status, note, attemptId) => c.check(action.resourceId, scope, kind, status, note, c.detail.data!.activity.version, attemptId)} />}</QueryState>;
}
export function ActionDispatcher({ action, ports, onClose, onPrimary }: { action: PrimaryAction | null; ports?: WorkbenchPorts; onClose: () => void; onPrimary?: (action: PrimaryAction) => void }) {
  if (!action) return null;
  return <ModalShell open onClose={onClose} labelledBy="action-dispatcher-title" className="modal-wide"><div className="modal-head"><h2 id="action-dispatcher-title">{action.label}</h2><button className="text-button" onClick={onClose}>关闭</button></div>{action.kind === "progress" || action.kind === "qualification" ? <TaskAction key={action.resourceId} action={action} ports={ports} /> : action.kind === "enrollment" ? <EnrollmentAction key={action.resourceId} action={action} ports={ports} /> : ["claim", "claim_result", "receipt", "reward_conditions"].includes(action.kind) && action.participationId ? <RewardAction key={action.resourceId} action={action} ports={ports} onPrimary={onPrimary} /> : <p>此行动需要打开对应业务详情，请从所属活动或卡片查看。缺少关联信息时不会推断业务命令。</p>}</ModalShell>;
}
