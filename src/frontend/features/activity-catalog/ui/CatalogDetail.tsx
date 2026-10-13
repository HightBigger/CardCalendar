import type { CatalogDetail as Detail } from "../../../../contracts/activity-catalog";
import { RulesView } from "../../activity-rules";
export function CatalogDetail({
  data,
  timezone,
  onJoin,
}: {
  data: Detail;
  timezone: string;
  onJoin?: () => void;
}) {
  const s = data.summary;
  return (
    <>
      <a href="/bank-activities" className="text-button">
        ← 银行活动中心
      </a>
      <header className="catalog-heading">
        <div>
          <p className="catalog-eyebrow">
            {s.bank.name} · 发布版本 {data.release.releaseNumber}
          </p>
          <h1>{s.name}</h1>
          <p>版本说明：{data.release.changeNote}</p>
        </div>
        <button
          className="primary-button"
          disabled={!s.join.enabled || !onJoin}
          onClick={onJoin}
        >
          加入我的卡片
        </button>
      </header>
      <p className="catalog-notice">
        加入只表示个人跟踪，银行报名、个人资格、达标、领取和到账均需分别确认。
      </p>
      {!s.join.enabled && (
        <p className="catalog-warning" role="status">
          {s.join.reason}
        </p>
      )}
      {s.unknownItems.length > 0 && (
        <section className="catalog-notice">
          <h2>规则待核对</h2>
          <ul>
            {s.unknownItems.map((x, i) => (
              <li key={i}>
                {x.reason}
                {x.blocksExecution ? "（阻止相关任务执行）" : ""}
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="catalog-panel">
        <RulesView content={data.release.content} timezone={timezone} />
      </section>
      {s.myParticipations.length > 0 && (
        <section className="catalog-panel">
          <h2>我的参与</h2>
          {s.myParticipations.map((p) => (
            <p key={p.participationId}>
              <a href={"/activities/" + p.participationId}>
                {p.card.name} · {p.card.last4}
              </a>
              {p.updateAvailable && " · 规则有更新，原绑定版本仍保留"}
            </p>
          ))}
        </section>
      )}
    </>
  );
}
