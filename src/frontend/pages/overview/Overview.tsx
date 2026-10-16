"use client";

import type { ReactNode } from "react";
import type { ApiUser, ApiCard, CardSummary, ApiFeeEvent, ApiReminder } from "../../../contracts/mvp";
import { fmtDate, money, ruleText } from "../../shared/display/legacy";
import { Icon } from "../../shared/ui";

export function Overview(props: {
  profile: ApiUser | null;
  cards: ApiCard[];
  summaries?: CardSummary[];
  events: ApiFeeEvent[];
  reminders: ApiReminder[];
  onAdd: () => void;
  onOpenCard: (card: ApiCard | CardSummary) => void;
  onGoCards: () => void;
  onGoReminders: () => void;
  recentTodos?: ReactNode;
}) {
  const pendingEvents = props.events.filter((event) => event.status === "pending");
  return (
    <div className="home-page">
      <header className="home-welcome">
        <h1>{props.profile?.name ? `${props.profile.name}，你好` : "欢迎回来"}</h1>
        <p>{props.cards.length ? `${props.cards.length} 张卡片 · 未来 90 天 ${pendingEvents.length} 项年费待确认` : "从第一张卡开始，记下年费和免年费规则。"}</p>
      </header>
      <div className="home-layout">
        {props.recentTodos ?? (
          <section className="home-panel" aria-labelledby="home-fees-title">
            <div className="section-heading"><h2 id="home-fees-title">近期年费</h2><span className="home-section-note">未来 90 天</span></div>
            {pendingEvents.length ? <div className="home-fee-list">{pendingEvents.slice(0, 5).map((event) => {
              const card = props.cards.find((item) => item.id === event.cardId);
              return <button key={event.id} className="home-fee-row" onClick={() => card && props.onOpenCard(card)} disabled={!card}>
                <span><strong>{card ? `${card.issuerName} · ${card.name}` : "年费待确认"}</strong><small>{fmtDate(event.dueDate)} · {money(event.expectedAmount, card?.currency)}</small></span><Icon name="arrow" size={16} />
              </button>;
            })}</div> : <div className="home-empty"><Icon name="check" size={22} /><p>近期没有要处理的年费。</p></div>}
            {props.reminders.length > 0 && <button className="text-button home-reminder-link" onClick={props.onGoReminders}>查看 {props.reminders.length} 条提醒 <Icon name="arrow" size={14} /></button>}
          </section>
        )}
        <section className="home-panel home-cards" aria-labelledby="home-cards-title">
          <div className="section-heading"><h2 id="home-cards-title">我的卡片</h2>{props.cards.length > 0 && <button className="text-button" onClick={props.onGoCards}>管理卡片 <Icon name="arrow" size={14} /></button>}</div>
          {props.cards.length ? <>
            <div className="home-card-list">{props.cards.slice(0, 3).map((card) => {
              const progress = props.summaries?.find((item) => item.id === card.id)?.progress;
              const remaining = [progress?.remainingCount ? `${progress.remainingCount} 次` : "", progress?.remainingAmount ? money(progress.remainingAmount, card.currency) : ""].filter(Boolean).join("、");
              return <button key={card.id} className="home-card-row" onClick={() => props.onOpenCard(card)}>
                <span className="home-card-identity"><span className="home-card-icon"><Icon name="credit" size={18} /></span><span><strong>{card.name}</strong><small>{card.issuerName} · {card.last4}{card.status === "suspended" ? " · 已停用" : ""}</small></span><Icon name="arrow" size={15} /></span>
                <span className="home-card-fee">年费 {money(card.annualFeeAmount, card.currency)}<span>{card.nextFeeDate ? fmtDate(card.nextFeeDate) : "日期待设置"}</span></span>
                {progress ? <span className="home-card-progress"><progress max={100} value={Math.min(100, Math.max(0, progress.percentage))} aria-label={`${card.name}免年费进度`} /><small>{progress.qualified ? "免年费已达标" : remaining ? `免年费还差 ${remaining}` : "免年费进度待核对"}</small></span> : <small className="home-card-rule">{ruleText(card)}</small>}
              </button>;
            })}</div>
            <button className="text-button home-add-card" onClick={props.onAdd}><Icon name="plus" size={16} />新增卡片</button>
          </> : <div className="home-empty home-cards-empty"><span className="home-empty-icon"><Icon name="credit" size={24} /></span><h3>添加第一张卡片</h3><p>记住日期和规则，剩下的交给提醒。</p><button className="primary-button" onClick={props.onAdd}><Icon name="plus" size={16} />新增第一张卡</button></div>}
        </section>
      </div>
    </div>
  );
}
