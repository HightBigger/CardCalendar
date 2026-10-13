import type { CatalogList as List } from "../../../../contracts/activity-catalog";
import { businessDate } from "../../../shared/display/business";
export function CatalogList({
  data,
  timezone,
}: {
  data: List;
  timezone: string;
}) {
  return (
    <>
      <p role="status">{data.total} 个活动</p>
      {!data.items.length && (
        <div className="empty-state">
          <h2>暂时没有符合条件的活动</h2>
          <p>调整银行、阶段或关键词筛选后重试。</p>
        </div>
      )}
      <div className="catalog-grid">
        {data.items.map((item) => (
          <article className="catalog-tile" key={item.id}>
            <div className="catalog-eyebrow">
              <span>{item.bank.name}</span>
              <span>
                {
                  {
                    upcoming: "即将开始",
                    ongoing: "进行中",
                    ended: "已结束",
                    cancelled: "银行取消",
                  }[item.phase]
                }
              </span>
            </div>
            <h2>
              <a href={"/bank-activities/" + item.id}>{item.name}</a>
            </h2>
            <p>
              {businessDate(item.start, timezone)} —{" "}
              {businessDate(item.end, timezone)}
            </p>
            <strong>{item.targetText}</strong>
            <p>{item.rewardText}</p>
            <small>
              最近关键日期：{businessDate(item.nextKeyDate, timezone)}
            </small>
            <p className="catalog-muted">{item.sourceStatusText}</p>
            {!!item.unknownItems.length && (
              <span className="catalog-warning">
                {item.unknownItems.length} 项规则待核对
              </span>
            )}
            {item.myParticipations.map((link) => (
              <p key={link.participationId}>
                <a href={"/activities/" + link.participationId}>
                  {link.card.name} · {link.card.last4}
                </a>{" "}
                已加入{link.updateAvailable && " · 规则有更新"}
              </p>
            ))}
          </article>
        ))}
      </div>
    </>
  );
}
