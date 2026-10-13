import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { isDeepStrictEqual } from 'node:util';
import EmbeddedPostgres from 'embedded-postgres';
import { Client, Pool } from 'pg';

const root=process.cwd(), output=join(root,'artifacts/cc21-22-backend-acceptance');
const results:any[]=[];
const unknown={kind:'unknown',reason:'未设置'};
const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date());
const monthStart=today.slice(0,7)+'-01';
const monthEnd=new Date(Date.UTC(Number(today.slice(0,4)),Number(today.slice(5,7)),0)).toISOString().slice(0,10);
const date=(value:string)=>({kind:'date',value,timezone:'Asia/Shanghai'});
const assert=(condition:unknown,observed:unknown)=>{if(!condition)throw new Error(JSON.stringify(observed));};
async function check(name:string,fn:()=>Promise<unknown>){try{const observed=await fn();results.push({name,status:'PASS',observed});}catch(e){results.push({name,status:'FAIL',observed:e instanceof Error?e.message:String(e)});}console.log(JSON.stringify(results.at(-1)));}
async function freePort():Promise<number>{return new Promise((resolve,reject)=>{const s=createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const a=s.address();s.close(()=>typeof a==='object'&&a?resolve(a.port):reject(new Error('port')));});});}

async function main(){
 const databaseDir=await mkdtemp(join(tmpdir(),'cardcalendar-acceptance-pg-'));
 const pgPort=await freePort(),httpPort=await freePort();
 const url=`postgres://postgres:postgres@127.0.0.1:${pgPort}/acceptance`;
 const pg=new EmbeddedPostgres({databaseDir,port:pgPort,user:'postgres',password:'postgres',persistent:false,initdbFlags:['--locale=C'],onLog:()=>undefined,onError:()=>undefined});
 const distDir=`.next-acceptance-${process.pid}`;
 const configBefore=await readFile('tsconfig.json','utf8'),nextEnvBefore=await readFile('next-env.d.ts','utf8');
 let server:ReturnType<typeof spawn>|undefined,db:Client|undefined,pool:Pool|undefined;
 let serverLog='';
 try{
  await pg.initialise();await pg.start();await pg.createDatabase('acceptance');
  db=new Client({connectionString:url});await db.connect();
  for(const f of (await readdir('db/migrations')).filter(n=>n.endsWith('.sql')&&!n.startsWith('._')).sort())await db.query(await readFile(join('db/migrations',f),'utf8'));
  process.env.DATABASE_URL=url;process.env.USE_DATABASE='true';
  const base=`http://127.0.0.1:${httpPort}`;
  async function startServer(enabled:boolean){
   const value=String(enabled),env:NodeJS.ProcessEnv={...process.env,NODE_ENV:'development',NEXT_DIST_DIR:distDir,FEATURE_CATALOG_READ:'false',FEATURE_CATALOG_MANAGE:'false',FEATURE_CATALOG_JOIN:'false',FEATURE_TODOS:value,FEATURE_ACTIVITIES:value,FEATURE_ACTIVITY_PERIODS:value};
   const child=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','-p',String(httpPort)],{cwd:root,env,stdio:['ignore','pipe','pipe']});server=child;
   child.stdout?.on('data',b=>{serverLog+=String(b);});child.stderr?.on('data',b=>{serverLog+=String(b);});
   const readyDeadline=Date.now()+90_000;let ready=false;
   while(Date.now()<readyDeadline){try{if((await fetch(base+'/api/v1/campaigns')).status===401){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,300));}
   assert(ready,'server did not start');
  }
  async function stopServer(){if(server){const child=server,closed=new Promise<void>(r=>child.once('close',()=>r()));child.kill('SIGTERM');await closed;server=undefined;}}
  await startServer(false);
  async function api(path:string,method='GET',body?:unknown,cookie='',key=randomUUID(),withOrigin=true){
   const headers:Record<string,string>={'content-type':'application/json','Idempotency-Key':key};if(cookie)headers.cookie=cookie;if(withOrigin)headers.origin=base;
   const r=await fetch(base+'/api/v1'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
   const text=await r.text();let data:any;try{data=JSON.parse(text);}catch{data={text:text.slice(0,500)};}
   return {status:r.status,body:data,cookie:r.headers.get('set-cookie')?.split(';')[0]??''};
  }
  const ok=(r:any,status=200)=>{assert(r.status===status,{status:r.status,body:r.body});return r.body.data;};
  const email=`acceptance-${randomUUID()}@example.invalid`,password='Acceptance123!';
  const registered=ok(await api('/auth/register','POST',{email,password,name:'架构验收'}),201);
  const login=await api('/auth/login','POST',{email,password});ok(login);const cookie=login.cookie;
  const userId=registered.user.id;
  const card=ok(await api('/cards','POST',{issuerName:'验收银行',name:'普通用户验收卡',last4:'1234',feeCycleType:'custom',nextFeeDate:'2027-01-01',waiveRuleType:'count',targetCount:5},cookie),201);
  await check('普通成员真实注册、密码登录、建卡',async()=>({userId,cardId:card.id}));
  const draft={cardId:card.id,name:'私人验收活动',sourceLabel:'架构验收',rulesText:'累计2笔且100元',enrollmentRequired:'no',channel:'',cycleType:'once',targetKind:'count_and_amount',targetCount:2,targetAmount:'100.00',currency:'CNY',countingBasis:'occurred',rewardText:'原文',startOn:monthStart,endOn:monthEnd};
  await check('关闭私人写入开关时拒绝新建',async()=>{const r=await api('/campaigns','POST',draft,cookie);assert(r.status!==200,{allPrivateFlags:false,status:r.status,created:r.body.data});return r.status;});
  // Test enabled product flows in a fresh process after the disabled gate check.
  await stopServer();await startServer(true);
  process.env.FEATURE_TODOS='true';process.env.FEATURE_ACTIVITIES='true';process.env.FEATURE_ACTIVITY_PERIODS='true';
  await check('真实Cookie与Origin鉴权及跨用户卡引用',async()=>{
   const missingOrigin=await api('/campaigns','POST',draft,cookie,randomUUID(),false);assert(missingOrigin.status===403,{status:missingOrigin.status});
   const missingSession=await api('/campaigns');assert(missingSession.status===401,{status:missingSession.status});
   const other=await api('/auth/register','POST',{email:`ownership-${randomUUID()}@example.invalid`,password});ok(other,201);
   const wrongOwner=await api('/campaigns','POST',draft,other.cookie);assert(wrongOwner.status===404,{status:wrongOwner.status});return {missingOrigin:403,missingSession:401,crossOwner:404};
  });
  await check('现有ActivityDraft空可选字段兼容',async()=>{const r=await api('/campaigns','POST',{...draft,startOn:'',endOn:'',sourceUrl:''},cookie);assert(r.status===200,{status:r.status,body:r.body});return r.status;});
  async function participate(input:any){const created=ok(await api('/campaigns','POST',input,cookie));const p=ok(await api(`/campaigns/${created.id}/participations`,'POST',{cardId:card.id,campaignVersion:created.version,activityInstanceKey:'opaque-client-key'},cookie));return p;}
  const p=await participate(draft);
  const detail=async(id=p.participationId)=>ok(await api(`/workbench/participations/${id}`,'GET',undefined,cookie));
  const plan=(r:any,mode='entries',startOn=monthStart,endOn=monthEnd,type='once')=>({type,startOn,endOn,timezone:'Asia/Shanghai',partialPolicy:'full_target',periods:[],affectedPeriodIds:[],targetKind:'count_and_amount',targetCount:2,targetAmount:'100.00',currency:'CNY',ruleVersionId:r.ruleVersionId,participationVersion:1,mode});
  await check('创建参与、一次性计划、独立资格核对',async()=>{
   ok(await api(`/activity-participations/${p.participationId}/period-plans`,'POST',plan(p),cookie));
   const d=await detail();ok(await api(`/activity-participations/${p.participationId}/actions`,'POST',{command:'record_eligibility',scope:'participation',expectedVersion:d.activity.version,status:'confirmed',note:'资格确认'},cookie));
   const after=await detail();assert(after.periods.length===1,after);return {periods:after.periods.length,version:after.activity.version};
  });
  let d=await detail();const taskId=d.periods[0].taskId,periodId=d.periods[0].id;
  const task=async(id=taskId)=>ok(await api(`/spend-tasks/${id}`,'GET',undefined,cookie));
  const todos=async(query='')=>ok(await api('/todos'+query,'GET',undefined,cookie));
  const actions=(v:any)=>v.groups.flatMap((g:any)=>g.items);
  await check('逐条消费待办主操作可用',async()=>{const t=await task(),a=actions(await todos()).find((x:any)=>x.primaryAction.resourceId===taskId&&x.type==='spend_period');assert(a?.primaryAction.enabled,{taskCommands:t.allowedCommands,action:a});return {enabled:a.primaryAction.enabled};});
  await check('逐条消费幂等、同键不同内容拒绝、累计计算',async()=>{
   let t=await task();const payload={count:1,amount:'50.00',occurredOn:today,stage:'occurred',note:'第一笔',taskVersion:t.version,evaluateTaskIds:[taskId]},key=randomUUID();
   const a=await api(`/activity-participations/${p.participationId}/spend-entries`,'POST',payload,cookie,key);ok(a);
   const replay=await api(`/activity-participations/${p.participationId}/spend-entries`,'POST',payload,cookie,key);ok(replay);assert(isDeepStrictEqual(a.body,replay.body),{a:a.body,replay:replay.body});
   const conflict=await api(`/activity-participations/${p.participationId}/spend-entries`,'POST',{...payload,amount:'60.00'},cookie,key);assert(conflict.status===409,conflict.body);
   t=await task();ok(await api(`/activity-participations/${p.participationId}/spend-entries`,'POST',{...payload,note:'第二笔',taskVersion:t.version},cookie));t=await task();assert(t.confirmed.count===2&&t.confirmed.amount==='100.00'&&t.progressStatus==='reached',t);return {confirmed:t.confirmed,conflict:conflict.status};
  });
  let rewardId='';
  await check('官方达标、奖励提交/确认/部分及全额到账完整HTTP链',async()=>{
   let t=await task();ok(await api(`/spend-tasks/${taskId}/qualification`,'POST',{expectedVersion:t.version,status:'met',scope:'period',periodId,note:'官方确认'},cookie));
   d=await detail();const reward=ok(await api(`/activity-participations/${p.participationId}/rewards`,'POST',{name:'验收返现',type:'cashback',quantity:'20.00',unit:'元',currency:'CNY',scope:'period',periodId,requiredPeriodIds:[],acquisition:'manual',claimStart:date(monthStart),claimDeadline:date(monthEnd),expectedReceipt:date(monthEnd),channel:'人工',instructions:'领取说明',receiptRuleText:'累计到账20元',participationVersion:d.activity.version,ruleVersionId:p.ruleVersionId},cookie)).reward;rewardId=reward.id;
   assert(reward.conditionStatus==='met',reward);
   let r=ok(await api(`/activity-rewards/${rewardId}/claim-attempts`,'POST',{expectedVersion:reward.version,occurredAt:new Date().toISOString(),note:'已提交'},cookie)).reward;
   assert(r.claimStatus==='submitted'&&r.receiptStatus!=='received',r);
   r=ok(await api(`/reward-claim-attempts/${r.claimAttempts[0].id}/results`,'POST',{expectedVersion:1,rewardVersion:r.version,status:'confirmed',note:'官方确认领取'},cookie)).reward;
   assert(r.claimStatus==='confirmed'&&r.receiptStatus!=='received',r);
   r=ok(await api(`/activity-rewards/${rewardId}/receipt-events`,'POST',{expectedVersion:r.version,receivedOn:today,quantity:'5.00',note:'部分到账'},cookie)).reward;
   assert(r.receivedText==='5.00'&&r.receiptStatus!=='received',r);
   r=ok(await api(`/activity-rewards/${rewardId}/receipt-events`,'POST',{expectedVersion:r.version,receivedOn:today,quantity:'15.00',note:'剩余到账'},cookie)).reward;
   assert(r.receiptStatus==='received',r);return {claim:r.claimStatus,receipt:r.receiptStatus,received:r.receivedText};
  });
  await check('完成待办后日历与列表行动ID/状态一致',async()=>{
   const list=await todos('?status=completed');const calendar=ok(await api(`/calendar-entries?status=completed&month=${today.slice(0,7)}`,'GET',undefined,cookie));
   const completed=actions(list);const ids=calendar.entries.filter((e:any)=>e.kind==='action').map((e:any)=>e.id);
   assert(completed.filter((a:any)=>a.deadline.kind==='date'&&a.deadline.value.startsWith(today.slice(0,7))).every((a:any)=>ids.includes(a.id)),{completed:completed.map((a:any)=>a.id),ids});return {actions:completed.length,calendarActions:ids.length};
  });
  await check('退款重评进度与奖励条件，保留已到账事实',async()=>{
   const t=await task(),factId=t.entries[0].id;
   const refund=await api(`/spend-facts/${factId}/reversals`,'POST',{expectedVersion:1,amount:'50.00',occurredOn:today,note:'第一笔全额退款'},cookie);ok(refund);
   const after=await task(),reward=(ok(await api(`/activity-participations/${p.participationId}/rewards`,'GET',undefined,cookie))).find((r:any)=>r.id===rewardId);
   assert(after.confirmed.amount==='50.00'&&after.qualificationStatus==='unknown'&&reward.conditionStatus==='unknown'&&reward.receiptStatus==='received',{task:after.confirmed,qualification:after.qualificationStatus,reward});return {amount:after.confirmed.amount,qualification:after.qualificationStatus,condition:reward.conditionStatus,receipt:reward.receiptStatus};
  });
  await check('整体目标官方已确认后不得静默修改并沿用旧达标结论',async()=>{
   const before=await detail();
   const base={key:'confirmed-overall',startOn:monthStart,endOn:monthEnd,timezone:'Asia/Shanghai',targetKind:'count',targetCount:1,currency:'CNY',mode:'entries',ruleVersionId:p.ruleVersionId};
   const created=ok(await api(`/activity-participations/${p.participationId}/overall-tasks`,'POST',{...base,participationVersion:before.activity.version},cookie)).task;
   const listed=ok(await api(`/activity-participations/${p.participationId}/overall-tasks`,'GET',undefined,cookie));
   assert(listed.items.some((item:any)=>item.id===created.id),listed);
   const confirmed=ok(await api(`/spend-tasks/${created.id}/qualification`,'POST',{expectedVersion:created.version,status:'met',scope:'participation',note:'官方确认整体目标'},cookie)).task;
   let current=await detail();
   const reward=ok(await api(`/activity-participations/${p.participationId}/rewards`,'POST',{
    name:'整体目标奖励',type:'cashback',quantity:'10.00',unit:'元',currency:'CNY',scope:'overall',requiredPeriodIds:[],overallTaskId:created.id,
    acquisition:'manual',claimStart:date(monthStart),claimDeadline:date(monthEnd),expectedReceipt:date(monthEnd),channel:'人工',
    instructions:'整体目标达标后领取',receiptRuleText:'整体目标达标',participationVersion:current.activity.version,ruleVersionId:p.ruleVersionId
   },cookie)).reward;
   assert(reward.conditionStatus==='met',{reward});
   current=await detail();
   const revised=await api(`/spend-tasks/${created.id}/overall-target`,'PATCH',{...base,targetCount:2,participationVersion:current.activity.version,expectedVersion:confirmed.version},cookie);
   const after=await task(created.id);
   const rewardAfter=(ok(await api(`/activity-participations/${p.participationId}/rewards`,'GET',undefined,cookie))).find((r:any)=>r.id===reward.id);
   const frozen=revised.status===422&&after.targetText===confirmed.targetText&&after.qualificationStatus==='met'&&rewardAfter?.conditionStatus==='met';
   const reevaluated=revised.status===200&&after.targetText!==confirmed.targetText&&after.qualificationStatus!=='met'&&rewardAfter?.conditionStatus!=='met';
   assert(frozen||reevaluated,{revisionStatus:revised.status,oldTarget:confirmed.targetText,target:after.targetText,qualification:after.qualificationStatus,rewardCondition:rewardAfter?.conditionStatus});
   return {revisionStatus:revised.status,target:after.targetText,qualification:after.qualificationStatus,rewardCondition:rewardAfter.conditionStatus};
  });
  await check('真实消费、评估、节点和计划完整导出',async()=>{
   const exported=ok(await api('/me/export','GET',undefined,cookie));const c=exported.catalogParticipation;const needed=['period_plan_revisions','participation_checks','spend_facts','spend_fact_events','task_evaluations','business_date_nodes','activity_reward_dependencies','workbench_jobs'];
   const missing=needed.filter(k=>!(k in c));assert(!missing.length,{missing,present:Object.keys(c)});return {keys:Object.keys(c)};
  });
  await check('posted声明阶段不得在成功响应中回退occurred',async()=>{
   const posted=await participate({...draft,name:'入账阶段活动',countingBasis:'posted'});ok(await api(`/activity-participations/${posted.participationId}/period-plans`,'POST',plan(posted),cookie));let pd=await detail(posted.participationId);
   ok(await api(`/activity-participations/${posted.participationId}/actions`,'POST',{command:'record_eligibility',scope:'participation',expectedVersion:pd.activity.version,status:'confirmed',note:'确认资格'},cookie));pd=await detail(posted.participationId);
   let t=await task(pd.periods[0].taskId);ok(await api(`/activity-participations/${posted.participationId}/spend-entries`,'POST',{count:1,amount:'50.00',occurredOn:today,stage:'posted',note:'已入账消费',taskVersion:t.version,evaluateTaskIds:[t.id]},cookie));t=await task(t.id);
   // A missing posting date must not be guessed. Check preservation of the
   // declared stage; the missing milestone can still require review.
   assert(t.entries[0].stage==='posted',{confirmed:t.confirmed,pending:t.pending,entry:t.entries[0]});return t.entries[0];
  });
  await check('无卡无日期自定义待办及完成/恢复/忽略历史',async()=>{
   let a=ok(await api('/todos','POST',{title:'无卡自定义',description:'验收',deadline:unknown,plannedFor:unknown,priority:'important'},cookie)).action;assert(a.card===null&&a.group==='undated',a);
   for(const command of ['complete','restore','ignore'])a=ok(await api(`/todos/${a.id}/actions`,'POST',{command,expectedVersion:a.version,note:'验收'},cookie)).action;
   assert(a.status==='ignored'&&a.history.length===4,a);return {status:a.status,history:a.history.map((h:any)=>h.command)};
  });
  await check('使用响应meta.asOf与nextCursor可继续翻页',async()=>{
   const first=await api('/todos?limit=1','GET',undefined,cookie);const list=ok(first);assert(list.nextCursor,{total:list.total});
   const query=new URLSearchParams({limit:'1',cursor:list.nextCursor,asOf:first.body.meta.asOf});const next=await api('/todos?'+query,'GET',undefined,cookie);
   assert(next.status===200,{status:next.status,body:next.body,asOf:first.body.meta.asOf,cursor:JSON.parse(Buffer.from(list.nextCursor,'base64url').toString())});return {firstTotal:list.total,nextStatus:next.status};
  });
  pool=new Pool({connectionString:url});
  const {CatalogRepository}=await import('../../src/modules/activity-catalog/repository');
  const {reconcileWorkbenchJobs}=await import('../../src/modules/participation/workbench-jobs');
  const repository=new CatalogRepository(pool);
  await check('排队后卡片暂停，worker重新校验并保留旧计划',async()=>{
   const longDraft={...draft,name:'批量任务验收',startOn:'2027-02-01',endOn:'2031-02-28',cycleType:'month'};
   const queued=await participate(longDraft);const q=ok(await api(`/activity-participations/${queued.participationId}/period-plans`,'POST',plan(queued,'snapshot',longDraft.startOn,longDraft.endOn,'month'),cookie),202);
   ok(await api(`/cards/${card.id}`,'PATCH',{status:'suspended'},cookie));
   await reconcileWorkbenchJobs(repository);
   const job=ok(await api(`/jobs/${q.jobId}`,'GET',undefined,cookie)),detailAfter=await detail(queued.participationId);
   assert(job.status==='failed'&&detailAfter.periods.length===0,{job,periods:detailAfter.periods.length,cardStatus:detailAfter.activity.card.status});return {job,periods:detailAfter.periods.length};
  });
  await check('SQL故障任务持久failed且候选整体回滚',async()=>{
   ok(await api(`/cards/${card.id}`,'PATCH',{status:'active'},cookie));
   const longDraft={...draft,name:'回滚验收',startOn:'2027-03-01',endOn:'2031-03-31',cycleType:'month'},queued=await participate(longDraft);
   const q=ok(await api(`/activity-participations/${queued.participationId}/period-plans`,'POST',plan(queued,'snapshot',longDraft.startOn,longDraft.endOn,'month'),cookie),202);
   await db!.query(`create function acceptance_fail_plan() returns trigger language plpgsql as $$ begin raise exception 'acceptance injected failure'; end $$; create trigger acceptance_fail_plan before insert on spend_tasks for each row execute function acceptance_fail_plan();`);
   let error='';try{await reconcileWorkbenchJobs(repository);}catch(e){error=e instanceof Error?e.message:String(e);}
   await db!.query('drop trigger acceptance_fail_plan on spend_tasks; drop function acceptance_fail_plan()');
   const job=ok(await api(`/jobs/${q.jobId}`,'GET',undefined,cookie)),after=await detail(queued.participationId);
   assert(!error&&job.status==='failed'&&after.periods.length===0,{error,job,periods:after.periods.length});return {job,periods:after.periods.length};
  });
  await check('无卡自定义待办账户删除后彻底清理',async()=>{
   const otherEmail=`delete-${randomUUID()}@example.invalid`;const rr=await api('/auth/register','POST',{email:otherEmail,password,name:'删除验收'});const other=ok(rr,201),otherCookie=rr.cookie;
   const a=ok(await api('/todos','POST',{title:'删除后不得残留',description:'',deadline:unknown,plannedFor:unknown,priority:'normal'},otherCookie)).action;
   ok(await api('/me/delete-request','POST',{confirmation:'DELETE'},otherCookie));
   const {runAccountCleanup}=await import('../../src/modules/account/cleanup');const cleanup=await runAccountCleanup();
   const remain=(await db!.query('select id from todo_actions where owner_user_id=$1',[other.user.id])).rows;
   const nodes=(await db!.query('select id from business_date_nodes where owner_user_id=$1',[other.user.id])).rows;
   assert(remain.length===0&&nodes.length===0,{cleanup,remainingActions:remain.length,remainingNodes:nodes.length,actionId:a.id});return cleanup;
  });
  await writeFile(join(output,'results.json'),JSON.stringify({executedAt:new Date().toISOString(),environment:'isolated PostgreSQL 18 + Next HTTP + ordinary password login; private flags false for gate test, true for product flows; catalog flags always false',results},null,2)+'\n');
 }finally{
  if(server){const closed=new Promise<void>(r=>server!.once('close',()=>r()));server.kill('SIGTERM');await closed;}
  if(pool)await pool.end();if(db)await db.end();
  const {getDatabase}=await import('../../src/shared/db/client');await getDatabase().pool.end();
  await pg.stop().catch(()=>undefined);await rm(databaseDir,{recursive:true,force:true});await rm(distDir,{recursive:true,force:true});
  // Remove only the isolated Next server's automatic generated config additions.
  const current=await readFile('tsconfig.json','utf8');if(current.includes(distDir))await writeFile('tsconfig.json',configBefore);
  const generated=await readFile('next-env.d.ts','utf8');if(generated.includes(distDir))await writeFile('next-env.d.ts',nextEnvBefore);
  await writeFile(join(output,'server.log'),serverLog);
 }
}
main().then(()=>{if(results.some(r=>r.status==='FAIL'))process.exit(1);}).catch(e=>{console.error(e);process.exit(1);});
