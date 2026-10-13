"use client";
import { FormEvent, useEffect, useMemo, useState } from "react";
import type { ApiUser, ApiCard, CardSummary, ApiCycle, ApiFeeEvent, ApiFeeEventHistory, ApiReminder, ApiReminderRule, ProgressEntry, ProgressData, CardDetail, CardDraft } from "../../../../contracts/mvp";
import { STATUS_LABEL, fmtDate, daysUntil, reminderOverdue, money, ruleText, cardLabel } from "../../../shared/display/legacy";
import { Icon, ModalShell } from "../../../shared/ui";
export function CardsView(props: {
  cards: CardSummary[];
  query: string;
  onQueryChange: (value: string) => void;
  onAdd: () => void;
  onEdit: (card: CardSummary) => void;
  onOpenCard: (card: CardSummary) => void;
}) {
  const [statusFilter, setStatusFilter] = useState("all");
  const [feeStatusFilter, setFeeStatusFilter] = useState("all");
  const [qualifiedFilter, setQualifiedFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortBy, setSortBy] = useState("due_date");
  const visibleCards = useMemo(() => {
    const filtered = props.cards.filter((card) =>
      (statusFilter === "all" || card.status === statusFilter) &&
      (feeStatusFilter === "all" || card.nextEvent?.status === feeStatusFilter) &&
      (qualifiedFilter === "all" || (card.progress?.qualified === (qualifiedFilter === "qualified"))) &&
      (!dateFrom || !card.nextFeeDate || card.nextFeeDate >= dateFrom) &&
      (!dateTo || !card.nextFeeDate || card.nextFeeDate <= dateTo),
    );
    return filtered.sort((a, b) => {
      if (sortBy === "remaining_count") return (a.progress?.remainingCount ?? 0) - (b.progress?.remainingCount ?? 0);
      if (sortBy === "remaining_amount") return (a.progress?.remainingAmount ?? 0) - (b.progress?.remainingAmount ?? 0);
      if (sortBy === "qualified") return (a.progress?.qualified ? 1 : 0) - (b.progress?.qualified ? 1 : 0);
      if (sortBy === "name") return (a.issuerName + a.name).localeCompare(b.issuerName + b.name);
      if (sortBy === "created_at") return b.createdAt.localeCompare(a.createdAt);
      return a.nextFeeDate.localeCompare(b.nextFeeDate);
    });
  }, [props.cards, statusFilter, feeStatusFilter, qualifiedFilter, dateFrom, dateTo, sortBy]);
  return (
    <>
      <div className="welcome-row">
        <div>
          <p className="eyebrow">我的卡片</p>
          <h1>我的卡片</h1>
          <p className="subline">维护每张卡的年费规则与免年费目标。</p>
        </div>
        <button className="primary-button" onClick={props.onAdd}>
          <Icon name="plus" size={17} />
          新增卡片
        </button>
      </div>
      <section className="section-block">
        <div className="toolbar">
          <label className="search-field">
            <Icon name="search" size={16} />
            <input value={props.query} onChange={(event) => props.onQueryChange(event.target.value)} placeholder="搜索银行、卡名或尾号" />
          </label>
          <select
            className="filter-button"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            aria-label="按状态筛选"
          >
            <option value="all">全部状态</option>
            <option value="active">使用中</option>
            <option value="suspended">已停用</option>
            <option value="archived">已归档</option>
          </select>
          <select
            className="filter-button"
            value={feeStatusFilter}
            onChange={(event) => setFeeStatusFilter(event.target.value)}
            aria-label="按年费状态筛选"
          >
            <option value="all">全部年费状态</option>
            <option value="pending">待确认</option>
            <option value="waived">已免除</option>
            <option value="charged">已扣费</option>
            <option value="refunded">已退费</option>
            <option value="not_applicable">无需处理</option>
          </select>
          <select
            className="filter-button"
            value={qualifiedFilter}
            onChange={(event) => setQualifiedFilter(event.target.value)}
            aria-label="按达标状态筛选"
          >
            <option value="all">全部进度</option>
            <option value="qualified">已达标</option>
            <option value="not_qualified">未达标</option>
          </select>
          <input className="filter-button date-filter" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} aria-label="年费起始日期" />
          <input className="filter-button date-filter" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} aria-label="年费结束日期" />
          <select
            className="filter-button"
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value)}
            aria-label="排序"
          >
            <option value="due_date">按年费日</option>
            <option value="remaining_count">按剩余次数</option>
            <option value="remaining_amount">按剩余金额</option>
            <option value="qualified">按达标状态</option>
            <option value="name">按卡片名称</option>
            <option value="created_at">按创建时间</option>
          </select>
        </div>
        {visibleCards.length ? (
          <div className="card-list">
            {visibleCards.map((card, index) => (
              <div className="card-row card-row-list" key={card.id}>
                <button className="card-row-main-button" onClick={() => props.onOpenCard(card)}>
                  <span className={"card-color " + ["green", "blue", "coral", "ink"][index % 4]} />
                  <span className="card-row-main">
                    <strong>{card.issuerName} · {card.name}</strong>
                    <small>尾号 {card.last4}{card.status !== "active" ? " · " + (STATUS_LABEL[card.status] || card.status) : ""} · 下次年费 {fmtDate(card.nextFeeDate)}{card.nextEvent?.status ? " · " + (STATUS_LABEL[card.nextEvent.status] || card.nextEvent.status) : ""}</small>
                  </span>
                </button>
                <span className="card-row-amount">{money(card.annualFeeAmount, card.currency)}</span>
                <span className={"status-pill" + (card.progress?.qualified ? " success" : "")}>{card.progress ? (card.progress.qualified ? "已达标" : Math.round(card.progress.percentage) + "%") : STATUS_LABEL[card.status] || card.status}</span>
                <button className="icon-button" aria-label="编辑" title="编辑" onClick={() => props.onEdit(card)}>
                  <Icon name="more" size={17} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <CardsEmptyState onAdd={props.onAdd} />
        )}
      </section>
    </>
  );
}


export function CardsEmptyState(props: { onAdd: () => void }) {
  return (
    <div className="empty-state">
      <Icon name="credit" size={26} />
      <strong>还没有信用卡</strong>
      <p>录入第一张卡，开始跟踪年费与免年费进度。</p>
      <button className="primary-button" onClick={props.onAdd}><Icon name="plus" size={16} />新增第一张卡</button>
    </div>
  );
}
