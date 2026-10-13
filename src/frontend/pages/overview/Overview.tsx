"use client";
import type { ReactNode } from "react";
import type { ApiUser, ApiCard, CardSummary, ApiCycle, ApiFeeEvent, ApiFeeEventHistory, ApiReminder, ApiReminderRule, ProgressEntry, ProgressData, CardDetail, CardDraft } from "../../../contracts/mvp";
import { STATUS_LABEL, fmtDate, daysUntil, reminderOverdue, money, ruleText, cardLabel } from "../../shared/display/legacy";
import { Icon, ModalShell } from "../../shared/ui";
import { CardsEmptyState as EmptyState } from "../../features/cards";
export function Overview(props: {
  profile: ApiUser | null;
  cards: ApiCard[];
  totalCards: number;
  activeCards: number;
  attentionCards: CardSummary[];
  events: ApiFeeEvent[];
  reminders: ApiReminder[];
  upcomingAmount: number;
  onAdd: () => void;
  onOpenCard: (card: ApiCard | CardSummary) => void;
  onGoCards: () => void;
  onGoReminders: () => void;
  recentTodos?: ReactNode;
}) {
  const overdueReminders = props.reminders.filter((reminder) => reminderOverdue(reminder));
  return (
    <>
      <div className="welcome-row">
        <div>
          <p className="eyebrow">工作台 / 运营总览</p>
          <h1>{props.profile?.name ? props.profile.name + "，你好" : "欢迎回来"}</h1>
          <p className="subline">未来 90 天年费与免年费进度都在这里。</p>
        </div>
        <button className="primary-button" onClick={props.onAdd}>
          <Icon name="plus" size={17} />
          新增卡片
        </button>
      </div>

      <section className="metrics" aria-label="概览指标">
        <div className="metric">
          <span className="metric-label">总卡片</span>
          <strong>{props.totalCards}</strong>
          <span className="metric-note"><Icon name="credit" size={14} />全部状态</span>
        </div>
        <div className="metric">
          <span className="metric-label">使用中卡片</span>
          <strong>{props.activeCards}</strong>
          <span className="metric-note"><Icon name="check" size={14} />不含停用/归档</span>
        </div>
        <div className="metric">
          <span className="metric-label">待处理提醒</span>
          <strong>{props.reminders.length}</strong>
          <span className="metric-note warning"><Icon name="clock" size={14} />{overdueReminders.length ? overdueReminders.length + " 条已逾期" : "需要确认"}</span>
        </div>
        <div className="metric">
          <span className="metric-label">未来 90 天年费</span>
          <strong>{money(props.upcomingAmount)}</strong>
          <span className="metric-note">共 {props.events.length} 张卡</span>
        </div>
        <div className="metric accent">
          <span className="metric-label">年费与通知</span>
          <strong>{props.events.length + props.reminders.length}</strong>
          <span className="metric-note success"><Icon name="check" size={14} />及时处理</span>
        </div>
      </section>

      <div className="dashboard-grid">
        <div className="primary-column">
          <section className="section-block">
            <div className="section-heading">
              <div>
                <p className="section-kicker">卡片概览</p>
                <h2>我的卡片 <span>{props.cards.length}</span></h2>
              </div>
              <button className="text-button" onClick={props.onGoCards}>查看全部 <Icon name="arrow" size={15} /></button>
            </div>
            {props.cards.length ? (
              <div className="card-list">
                {props.cards.map((card, index) => (
                  <button key={card.id} className="card-row" onClick={() => props.onOpenCard(card)}>
                    <span className={"card-color " + ["green", "blue", "coral", "ink"][index % 4]} />
                    <span className="card-row-main">
                      <strong>{card.issuerName} · {card.name}</strong>
                      </span>
                    <span className="card-row-amount">{money(card.annualFeeAmount, card.currency)}</span>
                    <span className="card-row-rule">{ruleText(card)}</span>
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState onAdd={props.onAdd} />
            )}
          </section>
          {props.recentTodos}
        </div>
        <div className="secondary-column">
          <section className="section-block">
            <div className="section-heading">
              <div>
                <p className="section-kicker">近期事项</p>
                <h2>未来 90 天年费</h2>
              </div>
            </div>
            {props.events.length ? (
              <div className="event-list compact">
                {props.events.slice(0, 5).map((event) => (
                  <div className="event-row" key={event.id}>
                    <span className="event-date">{fmtDate(event.dueDate)}</span>
                    <span className="event-main">
                      <strong>{cardLabel(event.cardId, props.cards)}</strong>
                      <small>{money(event.expectedAmount, props.cards.find((card) => card.id === event.cardId)?.currency)}</small>
                    </span>
                    <span className="status-pill">{STATUS_LABEL[event.status] || event.status}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty-note">未来 90 天没有年费事件。</p>
            )}
          </section>
          <section className="section-block">
            <div className="section-heading">
              <div>
                <p className="section-kicker">待处理事项</p>
                <h2>需要关注</h2>
              </div>
              <button className="text-button" onClick={props.onGoCards}>查看全部 <Icon name="arrow" size={15} /></button>
            </div>
            {props.attentionCards.length ? (
              <div className="event-list compact">
                {props.attentionCards.map((card) => (
                  <button key={card.id} className="event-row attention-row" onClick={() => props.onOpenCard(card)}>
                    <span className="event-date">{fmtDate(card.nextEvent?.dueDate ?? card.nextFeeDate)}</span>
                    <span className="event-main">
                      <strong>{card.issuerName} · {card.name}</strong>
                      <small>{card.progress ? "剩余 " + (card.progress.remainingCount ?? 0) + " 次 · " + money(card.progress.remainingAmount ?? 0, card.currency) : "未设置进度"}</small>
                    </span>
                    <span className="status-pill">{Math.round(card.progress?.percentage ?? 0)}%</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="empty-note">暂无需要关注的免年费进度。</p>
            )}
          </section>
          <section className="section-block">
            <div className="section-heading">
              <div>
                <p className="section-kicker">提醒</p>
                <h2>最近提醒</h2>
              </div>
              <button className="text-button" onClick={props.onGoReminders}>提醒中心 <Icon name="arrow" size={15} /></button>
            </div>
            {props.reminders.length ? (
              <div className="reminder-list compact">
                {overdueReminders.length > 0 && (
                  <p className="overdue-note"><Icon name="clock" size={15} />{overdueReminders.length} 条提醒已逾期，请尽快处理。</p>
                )}
                {props.reminders.slice(0, 4).map((reminder) => (
                  <div className={"reminder-row" + (reminderOverdue(reminder) ? " overdue" : "")} key={reminder.id}>
                    <Icon name="bell" size={16} />
                    <span>
                      <strong>{reminder.kind === "fee_event" ? "年费提醒" : "进度提醒"}</strong>
                      <small>{fmtDate(reminder.scheduledFor)} · 提前 {reminder.daysBefore} 天</small>
                    </span>
                    {reminderOverdue(reminder) && <b className="overdue-pill">已逾期</b>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty-note">暂无待处理提醒。</p>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
