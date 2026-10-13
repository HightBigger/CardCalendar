import type { TodosApi } from "../features/todos";
import type { ActivitiesApi } from "../features/activities";
import type { SpendTasksApi } from "../features/spend-tasks";
import type { RewardsApi } from "../features/rewards";
export type WorkbenchPorts = { todos?: TodosApi; activities?: ActivitiesApi; spendTasks?: SpendTasksApi; rewards?: RewardsApi };
