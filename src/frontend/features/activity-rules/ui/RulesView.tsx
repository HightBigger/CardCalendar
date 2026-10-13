import type { CatalogContent } from "../../../../contracts/activity-catalog";
import {
  businessDate,
  safeOfficialUrl,
} from "../../../shared/display/business";
export function RulesView({
  content,
  timezone = "Asia/Shanghai",
}: {
  content: CatalogContent;
  timezone?: string;
}) {
  const c = content;
  return (
    <div className="catalog-rules">
      <p>{c.summary}</p>
      <dl className="catalog-facts">
        <div>
          <dt>活动期</dt>
          <dd>
            {businessDate(c.start, timezone)} — {businessDate(c.end, timezone)}
          </dd>
        </div>
        <div>
          <dt>活动类型</dt>
          <dd>{c.activityType || "待核对"}</dd>
        </div>
        <div>
          <dt>周期口径</dt>
          <dd>
            {
              {
                month: "自然月",
                billing: "账单周期",
                custom: "自定义周期",
                once: "全期一次",
              }[c.periodTemplate.type]
            }{" "}
            · {c.periodTemplate.timezone ?? "时区待核对"} ·{" "}
            {
              {
                occurred: "按交易发生计入",
                posted: "按入账计入",
                settled: "按清算计入",
                unknown: "计入口径待核对",
              }[c.periodTemplate.countingBasis]
            }
          </dd>
        </div>
        <div>
          <dt>目标原文</dt>
          <dd>{c.periodTemplate.target.rulesText || "待核对"}</dd>
        </div>
      </dl>
      <h3>参与条件</h3>
      <dl className="catalog-facts">
        {(
          [
            ["cardTypesText", "适用卡种"],
            ["customerSegmentsText", "客群"],
            ["regionText", "地区"],
            ["channelText", "渠道"],
            ["exclusionsText", "排除条件"],
            ["quotaText", "名额"],
          ] as const
        ).map(([key, label]) => (
          <div key={key}>
            <dt>{label}</dt>
            <dd>{c.conditions[key] || "待核对"}</dd>
          </div>
        ))}
        <div>
          <dt>报名</dt>
          <dd>
            {c.conditions.enrollmentRequired === "yes"
              ? "需要自行在银行渠道报名"
              : c.conditions.enrollmentRequired === "no"
                ? "规则不要求报名"
                : "报名要求待核对"}
          </dd>
        </div>
        <div>
          <dt>报名截止</dt>
          <dd>{businessDate(c.conditions.enrollmentDeadline, timezone)}</dd>
        </div>
      </dl>
      <h3>奖励及领取</h3>
      {!c.rewards.length && <p>奖励规则待核对</p>}
      {c.rewards.map((r) => (
        <article className="catalog-subform" key={r.rewardKey}>
          <h4>{r.name}</h4>
          <p>
            {r.amountOrQuantity ?? "数量待核对"} {r.unit ?? ""} ·{" "}
            {
              {
                period: "每周期",
                all_periods: "所有周期达标后",
                overall: "独立全期目标",
              }[r.scope]
            }
          </p>
          <p>{r.conditionsText || "条件待核对"}</p>
          <p>
            {r.acquisition === "manual"
              ? "主动领取"
              : r.acquisition === "automatic"
                ? "自动发放"
                : "获得方式待核对"}{" "}
            · {r.channel ?? "渠道待核对"}
          </p>
          <p>
            领取窗口：{businessDate(r.claimStart, timezone)} —{" "}
            {businessDate(r.claimEnd, timezone)}
          </p>
          <p>
            预计到账：{businessDate(r.expectedReceipt, timezone)} ·{" "}
            {r.receiptRuleText}
          </p>
          {safeOfficialUrl(r.officialUrl ?? undefined) && (
            <a href={r.officialUrl!} target="_blank" rel="noopener noreferrer">
              查看领取官方渠道
            </a>
          )}
        </article>
      ))}
      <h3>官方出处</h3>
      {c.sources.map((s, i) => (
        <article key={i} className="catalog-source">
          <a
            href={safeOfficialUrl(s.url)}
            target="_blank"
            rel="noopener noreferrer"
          >
            {s.url}
          </a>
          <blockquote>{s.excerpt}</blockquote>
          <small>
            访问：{s.accessedAt ?? "待核对"} · 最后核对：
            {s.verifiedAt ?? "待核对"} ·{" "}
            {s.completeness === "complete"
              ? "完整"
              : s.completeness === "partial"
                ? "不完整"
                : "完整度未知"}
          </small>
        </article>
      ))}
      {c.bankCancellation && (
        <div className="form-error">
          银行确认取消：{c.bankCancellation.reason}{" "}
          <a
            href={safeOfficialUrl(c.bankCancellation.officialSourceUrl)}
            target="_blank"
            rel="noopener noreferrer"
          >
            官方证据
          </a>
        </div>
      )}
    </div>
  );
}
