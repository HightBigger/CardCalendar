import type { CatalogRepository } from "../activity-catalog/repository";
import { parse } from "../activity-catalog/service";
import { commandHash } from "../../shared/db/command-hash";
import { AppError } from "../../shared/errors";
import { workbenchRuntime } from "../../server/workbench/runtime";
import { PeriodPlanService, planBoundaries, planSchema } from "./period-plans";

type ClaimedJob = {
  id: string;
  owner_user_id: string;
  participation_id: string;
  input: unknown;
  input_hash: string;
  expected_version: number;
  attempt: number;
  lease_token: string;
};

async function claim(repository: CatalogRepository): Promise<ClaimedJob | undefined> {
  return repository.transaction(async (tx) => {
    const job = (await tx.query(`select * from workbench_jobs
      where status in ('queued','running') and (lease_until is null or lease_until < now())
      order by created_at,id limit 1 for update skip locked`)).rows[0];
    if (!job) return undefined;
    const token = crypto.randomUUID();
    const result = (await tx.query(`update workbench_jobs set status='running',
      attempt=attempt+$2,lease_token=$3,lease_until=now()+interval '2 minutes',message=null
      where id=$1 returning *`, [job.id, job.status === "running" ? 1 : 0, token])).rows[0];
    return result as ClaimedJob;
  });
}

async function processJob(repository: CatalogRepository, job: ClaimedJob) {
  const input = parse(planSchema, job.input);
  const boundaries = planBoundaries(input);
  if (job.input_hash !== commandHash(input))
    throw new AppError("CONFLICT", "任务输入摘要已变化");

  for (let start = 0; start < boundaries.length; start += 48) {
    await repository.transaction(async (tx) => {
      const current = (await tx.query(`select id from workbench_jobs
        where id=$1 and lease_token=$2 and attempt=$3 and status='running' and lease_until>now()
        for update`, [job.id, job.lease_token, job.attempt])).rows[0];
      if (!current) throw new AppError("CONFLICT", "任务租约已失效");
      for (let index = start; index < Math.min(start + 48, boundaries.length); index++)
        await tx.query(`insert into period_plan_candidates(job_id,ordinal,content)
          values($1,$2,$3) on conflict(job_id,ordinal) do update set content=excluded.content`,
          [job.id, index, boundaries[index]]);
      await tx.query(`update workbench_jobs set progress=$2,lease_until=now()+interval '2 minutes'
        where id=$1`, [job.id, Math.min(75, Math.floor((start + 48) / boundaries.length * 75))]);
    });
  }

  await repository.transaction(async (tx) => {
    const account=(await tx.query("select status,deleted_at from users where id=$1 for share",[job.owner_user_id])).rows[0];
    if (!account || account.status !== "active" || account.deleted_at)
      throw new AppError("UNPROCESSABLE_ENTITY", "账户不可用，候选计划不能激活");
    const personal = workbenchRuntime(repository.pool).workflow.personal;
    const p = await personal.owned(tx, job.owner_user_id, job.participation_id, true);
    const current = (await tx.query(`select * from workbench_jobs where id=$1
      and lease_token=$2 and attempt=$3 and status='running' and lease_until>now() for update`,
      [job.id, job.lease_token, job.attempt])).rows[0];
    if (!current) throw new AppError("CONFLICT", "任务租约已失效");
    if (p.version !== current.expected_version || current.input_hash !== commandHash(input))
      throw new AppError("CONFLICT", "参与版本或任务输入已变化");
    const candidates = (await tx.query(`select ordinal,content from period_plan_candidates
      where job_id=$1 order by ordinal for share`, [job.id])).rows;
    if (candidates.length !== boundaries.length || candidates.some((c, i) => c.ordinal !== i || commandHash(c.content) !== commandHash(boundaries[i])))
      throw new AppError("CONFLICT", "候选周期不完整或已变化");
    const service = new PeriodPlanService(personal);
    await service.validate(tx, p, input, boundaries);
    await service.activate(tx, p, input, boundaries);
    await tx.query(`update workbench_jobs set status='succeeded',progress=100,result=$2,
      lease_token=null,lease_until=null where id=$1 and lease_token=$3 and attempt=$4`,
      [job.id, { participationId: p.id }, job.lease_token, job.attempt]);
  });
}

export async function reconcileWorkbenchJobs(repository: CatalogRepository, limit = 4) {
  if (process.env.FEATURE_TODOS !== "true" || process.env.FEATURE_ACTIVITIES !== "true" || process.env.FEATURE_ACTIVITY_PERIODS !== "true")
    return { succeeded: 0, failed: 0 };
  let succeeded = 0;
  let failed = 0;
  for (let index = 0; index < limit; index++) {
    const job = await claim(repository);
    if (!job) break;
    try {
      await processJob(repository, job);
      succeeded++;
    } catch (error) {
      await repository.transaction(async (tx) => {
        await tx.query(`update workbench_jobs set status='failed',message=$2,retryable=true,
          lease_token=null,lease_until=null where id=$1 and lease_token=$3 and attempt=$4`,
          [job.id, error instanceof Error ? error.message : "计划任务失败", job.lease_token, job.attempt]);
      });
      failed++;
    }
  }
  return { succeeded, failed };
}
