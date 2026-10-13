import { dispatchTodoNotifications } from "../modules/todos/notification-dispatch";
import { CatalogRepository } from "../modules/activity-catalog/repository";
import { CatalogService } from "../modules/activity-catalog/service";
import { CatalogParticipationWorkflow } from "../server/workflows/catalog-participation";
import { getDatabase } from "../shared/db/client";
import { reconcileWorkbenchJobs } from "../modules/participation/workbench-jobs";
export async function runCatalogDispatch() {
  const repository = new CatalogRepository(getDatabase().pool);
  // Event delivery and notifications are persistent projections. They remain
  // recoverable while catalog discovery is disabled; only source adapters gate catalog writes.
  const events = await new CatalogParticipationWorkflow(new CatalogService(repository)).dispatchEvents(10);
  const todosEnabled=process.env.FEATURE_TODOS==="true";
  const activitiesEnabled=todosEnabled&&process.env.FEATURE_ACTIVITIES==="true";
  if (!todosEnabled || !activitiesEnabled)
    await repository.transaction(tx=>tx.query(`update todo_notification_schedules s set status='cancelled'
      where s.status='pending' and exists (
        select 1 from business_date_nodes n where n.id=s.node_id and n.owner_user_id=s.owner_user_id
        and ($1::boolean=false or n.source_kind='activity'))`,[todosEnabled]));
  const notifications = todosEnabled ? await dispatchTodoNotifications(repository) : {delivered:0,cancelled:0};
  const jobs = await reconcileWorkbenchJobs(repository);
  return { events, notifications, jobs };
}
