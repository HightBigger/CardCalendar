"use client";
import type * as C from "../../../../contracts/activity-catalog";
import { ModalShell, QueryState } from "../../../shared/ui";
import { useCatalogJoinController } from "../application/useCatalogJoinController";
export function JoinActivityDialog({
  detail,
  scope,
  onClose,
  onJoined,
}: {
  detail: C.CatalogDetail;
  scope: string;
  onClose: () => void;
  onJoined: (ids: string[]) => void;
}) {
  const {
    cards,
    selected,
    setSelected,
    ack,
    setAck,
    boundaries,
    setBoundaries,
    preview,
    error,
    busy,
    calendar,
    setCalendar,
    todo,
    setTodo,
    notifyDays,
    setNotifyDays,
    command,
    change,
    review,
    join,
    associate,
    needsBoundaries,
  } = useCatalogJoinController(detail, scope, onJoined);
  return (
    <ModalShell
      open
      onClose={onClose}
      labelledBy="catalog-join-title"
      className="modal-wide"
    >
      <div className="modal-head">
        <h2 id="catalog-join-title">加入我的卡片</h2>
        <button className="text-button" onClick={onClose}>
          关闭
        </button>
      </div>
      <div className="catalog-page">
        <p className="catalog-notice">
          每张卡独立建立个人参与。加入不代表银行报名、资格或奖励成功；关键未知项仅形成待核对计划。
        </p>
        <QueryState
          {...cards}
          hasData={!!cards.data}
          retry={cards.reload}
          label="本人卡片"
        >
          {cards.data?.length === 0 && (
            <p>
              还没有可用卡片。<a href="/cards">先添加卡片</a>
              ，仍可继续阅读活动规则。
            </p>
          )}
          {cards.data?.map((card) => (
            <section key={card.id} className="catalog-subform">
              <label className="catalog-check">
                <input
                  type="checkbox"
                  disabled={busy || command.busy}
                  checked={selected.includes(card.id)}
                  onChange={(e) => {
                    setSelected(
                      e.target.checked
                        ? [...selected, card.id]
                        : selected.filter((x) => x !== card.id),
                    );
                    change();
                  }}
                />
                {card.bank} · {card.name} · {card.last4}
              </label>
              {card.bankId !== detail.summary.bank.id && (
                <>
                  <p className="catalog-warning">
                    统一银行关联待核对。确认前，该卡只能保存待核对计划。
                  </p>
                  <button
                    className="secondary-button"
                    disabled={busy || command.busy}
                    onClick={() => associate(card.id)}
                  >
                    我确认此卡属于{detail.summary.bank.name}
                  </button>
                </>
              )}
              {needsBoundaries && selected.includes(card.id) && (
                <div>
                  <p>私人周期边界（不填则仅保存待核对计划）</p>
                  {(boundaries[card.id] ?? []).map((b, i) => (
                    <div key={i} className="catalog-fields">
                      <label>
                        周期开始
                        <input
                          type="date"
                          value={b.startOn}
                          onChange={(e) => {
                            setBoundaries({
                              ...boundaries,
                              [card.id]: boundaries[card.id].map((x, j) =>
                                j === i ? { ...x, startOn: e.target.value } : x,
                              ),
                            });
                            change();
                          }}
                        />
                      </label>
                      <label>
                        周期结束
                        <input
                          type="date"
                          value={b.endOn}
                          onChange={(e) => {
                            setBoundaries({
                              ...boundaries,
                              [card.id]: boundaries[card.id].map((x, j) =>
                                j === i ? { ...x, endOn: e.target.value } : x,
                              ),
                            });
                            change();
                          }}
                        />
                      </label>
                      <label>
                        私人周期时区
                        <input
                          value={b.timezone}
                          onChange={(e) => {
                            setBoundaries({
                              ...boundaries,
                              [card.id]: boundaries[card.id].map((x, j) =>
                                j === i
                                  ? { ...x, timezone: e.target.value }
                                  : x,
                              ),
                            });
                            change();
                          }}
                        />
                      </label>
                    </div>
                  ))}
                  <button
                    className="secondary-button"
                    onClick={() => {
                      setBoundaries({
                        ...boundaries,
                        [card.id]: [
                          ...(boundaries[card.id] ?? []),
                          {
                            periodKey:
                              "private-" +
                              ((boundaries[card.id]?.length ?? 0) + 1),
                            startOn: "",
                            endOn: "",
                            timezone:
                              detail.release.content.periodTemplate.timezone ??
                              "Asia/Shanghai",
                          },
                        ],
                      });
                      change();
                    }}
                  >
                    添加确认过的周期边界
                  </button>
                </div>
              )}
            </section>
          ))}
        </QueryState>
        <fieldset>
          <legend>节点偏好</legend>
          {[
            ["在日历显示", calendar, setCalendar],
            ["创建待办", todo, setTodo],
          ].map(([label, checked, set]) => (
            <label className="catalog-check" key={String(label)}>
              <input
                type="checkbox"
                checked={checked as boolean}
                onChange={(e) => {
                  (set as (v: boolean) => void)(e.target.checked);
                  change();
                }}
              />
              {label as string}
            </label>
          ))}
          <p>活动通知默认关闭。选择提前天数；通知与待办、日历分别设置。</p>
          {[1, 3, 7, 14, 30].map((days) => (
            <label className="catalog-check" key={days}>
              <input
                type="checkbox"
                checked={notifyDays.includes(days)}
                disabled={busy || command.busy}
                onChange={(e) => {
                  setNotifyDays(
                    e.target.checked
                      ? [...notifyDays, days].sort((a, b) => a - b)
                      : notifyDays.filter((n) => n !== days),
                  );
                  change();
                }}
              />
              提前 {days} 天通知
            </label>
          ))}
        </fieldset>
        <button
          className="secondary-button"
          disabled={busy || command.busy || !selected.length}
          onClick={review}
        >
          {busy ? "正在核对…" : "只读预览加入结果"}
        </button>
        {preview && (
          <section className="catalog-notice">
            <h3>加入预览（尚未写入）</h3>
            {preview.items.map((item) => (
              <div key={item.card.id}>
                <strong>
                  {item.card.name} · {item.card.last4}
                </strong>
                <p>
                  {item.existingParticipationId
                    ? "已加入，将返回原参与，不升级原规则"
                    : item.canActivate
                      ? "可建立明确周期，个人资格与报名仍待确认"
                      : "仅保存待核对计划，不激活未知任务"}
                </p>
                <ul>
                  {item.issues.map((x, i) => (
                    <li key={i}>{x.message}</li>
                  ))}
                </ul>
              </div>
            ))}
            <label className="catalog-check">
              <input
                type="checkbox"
                checked={ack}
                onChange={(e) => setAck(e.target.checked)}
              />
              我已核对所选卡、私人边界和所有待核对项，理解加入仅表示跟踪
            </label>
            <button
              className="primary-button"
              disabled={!ack || command.busy}
              onClick={join}
            >
              {command.busy ? "正在提交…" : "确认加入我的卡片"}
            </button>
          </section>
        )}
        {(error || command.error) && (
          <p className="form-error" role="alert">
            {error || command.error}
          </p>
        )}
      </div>
    </ModalShell>
  );
}
