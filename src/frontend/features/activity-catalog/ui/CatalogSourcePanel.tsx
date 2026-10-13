"use client";
import type { ActivityDetail } from "../../../../contracts/activities";
import { QueryState } from "../../../shared/ui";
import { RulesView } from "../../activity-rules";
import { useCatalogSourceController } from "../application/useCatalogSourceController";
export function CatalogSourcePanel({
  detail,
  scope,
}: {
  detail: ActivityDetail;
  scope: string;
}) {
  const {
    query,
    data,
    diff,
    command,
    future,
    setFuture,
    decisions,
    setDecisions,
    note,
    setNote,
    tracking,
    setTracking,
    rewardPolicy,
    setRewardPolicy,
    confirmed,
    setConfirmed,
    queued,
    send,
    today,
  } = useCatalogSourceController(detail, scope);
  return (
    <section className="section-block catalog-page">
      <QueryState
        {...query}
        hasData={!!data}
        retry={query.reload}
        label="目录来源"
      >
        {data && (
          <>
            <h2>目录来源与私人版本</h2>
            <p>
              最初加入版本：{data.source.initialReleaseId}
              <br />
              当前绑定：发布 v{data.release.releaseNumber} ·{" "}
              {data.source.boundReleaseId}
            </p>
            <details>
              <summary>查看保留的原规则与官方出处</summary>
              <RulesView content={data.release.content} />
            </details>
            {data.source.bankCancellation && (
              <p className="form-error">
                银行已确认取消：{data.source.bankCancellation.reason}
                。新的消费动作停止，原奖励及历史保留核对。
              </p>
            )}
            {data.source.publicationStatus === "withdrawn" && (
              <div className="catalog-notice">
                <h3>目录已下架</h3>
                <p>原因：{data.source.withdrawalReason}</p>
                <p>
                  银行是否取消与目录下架分别记录。当前跟踪决定：
                  {
                    {
                      continue: "继续跟踪",
                      stop_future: "停止未来跟踪",
                      needs_confirmation: "待成员确认",
                    }[data.source.trackingDecision]
                  }
                </p>
                <label>
                  未来跟踪
                  <select
                    value={tracking}
                    onChange={(e) =>
                      setTracking(e.target.value as typeof tracking)
                    }
                  >
                    <option value="continue">继续保留个人跟踪</option>
                    <option value="stop_future">停止未来周期跟踪</option>
                  </select>
                </label>
                <label>
                  已有奖励通知策略
                  <select
                    value={rewardPolicy}
                    onChange={(e) =>
                      setRewardPolicy(e.target.value as typeof rewardPolicy)
                    }
                  >
                    <option value="continue">继续核对已有奖励</option>
                    <option value="stop">停止已有奖励通知（记录保留）</option>
                    <option value="needs_confirmation">
                      待确认（暂停通知）
                    </option>
                  </select>
                </label>
                <label>
                  决定说明
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </label>
                <button
                  className="secondary-button"
                  disabled={
                    !note.trim() || command.busy || !data.source.noticeId
                  }
                  onClick={() =>
                    send("/catalog-tracking-decisions", {
                      expectedVersion: detail.activity.version,
                      noticeId: data.source.noticeId,
                      decision: tracking,
                      rewardReminderPolicy: rewardPolicy,
                      note,
                    })
                  }
                >
                  确认跟踪决定
                </button>
              </div>
            )}
            {data.source.latestReleaseId !== data.source.boundReleaseId &&
              data.source.latestReleaseId && (
                <div className="catalog-panel">
                  <h3>规则有更新</h3>
                  <p>
                    采用之前，私人周期仍绑定原规则。已消费、冻结周期、领取和到账事实保持原记录。
                  </p>
                  <QueryState
                    {...diff}
                    hasData={!!diff.data}
                    retry={diff.reload}
                    label="规则差异"
                  >
                    {diff.data && (
                      <>
                        {diff.data.changes.map((change, i) => (
                          <details key={i}>
                            <summary>
                              {{
                                name: "名称",
                                summary: "简介",
                                start: "开始日期",
                                end: "结束日期",
                                conditions: "参与条件",
                                periodTemplate: "周期及刷卡目标",
                                rewards: "奖励与领取安排",
                                sources: "官方来源",
                                unknownItems: "待核对项",
                                bankCancellation: "银行取消证据",
                              }[change.field] ?? change.field}{" "}
                              ·{" "}
                              {
                                {
                                  source: "来源信息",
                                  current_period: "当前周期",
                                  future_periods: "未来周期",
                                  rewards: "奖励",
                                  dates: "日期",
                                }[change.affects]
                              }
                            </summary>
                            <p>原内容</p>
                            <pre>{change.beforeText}</pre>
                            <p>新内容</p>
                            <pre>{change.afterText}</pre>
                          </details>
                        ))}
                        <h4>明确选择要修改的未来周期</h4>
                        {detail.periods
                          .filter((p) => p.startOn > today)
                          .map((p) => (
                            <label key={p.id} className="catalog-check">
                              <input
                                type="checkbox"
                                checked={future.includes(p.id)}
                                onChange={(e) =>
                                  setFuture(
                                    e.target.checked
                                      ? [...future, p.id]
                                      : future.filter((x) => x !== p.id),
                                  )
                                }
                              />
                              {p.label} · {p.targetText}
                            </label>
                          ))}
                        <h4>当前周期决定</h4>
                        {detail.periods
                          .filter((p) => p.startOn <= today && p.endOn >= today)
                          .map((p) => (
                            <label key={p.id}>
                              {p.label}
                              <select
                                aria-label={"当前周期决定 · " + p.label}
                                value={decisions[p.id] ?? ""}
                                onChange={(e) =>
                                  setDecisions({
                                    ...decisions,
                                    [p.id]: e.target.value as
                                      | "keep_frozen"
                                      | "create_review_revision",
                                  })
                                }
                              >
                                <option value="">请选择</option>
                                <option value="keep_frozen">
                                  保留冻结规则
                                </option>
                                <option value="create_review_revision">
                                  追加待核对修订，保留原消费及目标
                                </option>
                              </select>
                            </label>
                          ))}
                        <label>
                          采用说明
                          <textarea
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                          />
                        </label>
                        <label className="catalog-check">
                          <input
                            type="checkbox"
                            checked={confirmed}
                            onChange={(e) => setConfirmed(e.target.checked)}
                          />
                          我已阅读原/新规则差异并确认选择范围
                        </label>
                        <button
                          className="primary-button"
                          disabled={!confirmed || !note.trim() || command.busy}
                          onClick={() =>
                            send("/adopt-catalog-release", {
                              expectedVersion: diff.data!.participationVersion,
                              targetReleaseId: diff.data!.targetReleaseId,
                              affectedFuturePeriodIds: future,
                              currentPeriodDecisions: detail.periods
                                .filter(
                                  (p) => p.startOn <= today && p.endOn >= today,
                                )
                                .map((p) => ({
                                  periodId: p.id,
                                  expectedVersion: p.version ?? 1,
                                  decision: decisions[p.id],
                                  note,
                                })),
                              note,
                            })
                          }
                        >
                          确认采用新版
                        </button>
                      </>
                    )}
                  </QueryState>
                </div>
              )}
          </>
        )}
      </QueryState>
      {command.error && (
        <p className="form-error" role="alert">
          {command.error}
        </p>
      )}
      {queued && <p role="status">修订已排队，尚未生效。任务 {queued}</p>}
    </section>
  );
}
