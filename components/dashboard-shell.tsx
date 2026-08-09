"use client";

import { FormEvent, useState } from "react";
import { Icon } from "./icons";

export type Card = {
  id: string;
  bank: string;
  name: string;
  last4: string;
  color: "ink" | "blue" | "coral" | "green";
  annualFee: number;
  feeDate: string;
  requirement: string;
  current: number;
  target: number;
  unit: "金额" | "次数";
  status: string;
};

export type CardDraft = {
  issuerName: string;
  name: string;
  last4: string;
  annualFeeAmount: number;
  nextFeeDate: string;
  feeCycleType: "custom";
  waiveRuleType: "none" | "count" | "amount" | "count_and_amount" | "custom";
  targetCount?: number;
  targetAmount?: number;
  customRuleText?: string;
};

type ShellProps = {
  cards: Card[];
  totalCards: number;
  query: string;
  onQueryChange: (value: string) => void;
  onAdd: () => void;
  notice: string | null;
  onDismissNotice: () => void;
  addOpen: boolean;
  onAddClose: () => void;
  onAddSubmit: (draft: CardDraft) => void;
};

const upcoming = [
  {
    date: "08 / 27",
    label: "中国银行 · 长城世界卡",
    amount: "¥800",
    days: "22 天后",
    tone: "amber",
  },
  {
    date: "09 / 18",
    label: "招商银行 · 经典白金卡",
    amount: "¥3,600",
    days: "44 天后",
    tone: "blue",
  },
  {
    date: "11 / 04",
    label: "浦发银行 · 超白金卡",
    amount: "¥6,800",
    days: "91 天后",
    tone: "coral",
  },
];

const reminders = [
  {
    title: "中国银行 · 长城世界卡",
    body: "还差 3 次消费，建议在本周完成",
    when: "今天",
    urgent: true,
  },
  {
    title: "招商银行 · 经典白金卡",
    body: "距离年费日还有 44 天",
    when: "昨天",
    urgent: false,
  },
];

function formatProgress(card: Card) {
  const percent = Math.min(100, Math.round((card.current / card.target) * 100));
  const remaining = Math.max(0, card.target - card.current);
  const remain =
    card.unit === "金额"
      ? `¥${remaining.toLocaleString("zh-CN")}`
      : `${remaining} 次`;
  return { percent, remain };
}

export function DashboardShell({
  cards,
  totalCards,
  query,
  onQueryChange,
  onAdd,
  notice,
  onDismissNotice,
  addOpen,
  onAddClose,
  onAddSubmit,
}: ShellProps) {
  const [activeNav, setActiveNav] = useState("概览");
  const [mobileNav, setMobileNav] = useState(false);
  const [dismissed, setDismissed] = useState<string[]>([]);

  return (
    <main className="app-frame">
      <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
        <div className="brand">
          <span className="brand-mark">
            <Icon name="calendar" size={20} />
          </span>
          <span>卡片档案</span>
          <small>CARDFOLIO</small>
        </div>
        <nav className="nav-list" aria-label="主导航">
          {["概览", "我的卡片", "年费日历", "提醒中心"].map((item, i) => (
            <button
              key={item}
              className={`nav-item ${activeNav === item ? "active" : ""}`}
              onClick={() => {
                setActiveNav(item);
                setMobileNav(false);
              }}
            >
              <Icon
                name={["grid", "credit", "calendar", "bell"][i] as any}
                size={18}
              />
              <span>{item}</span>
              {item === "提醒中心" && <b className="nav-count">2</b>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button className="nav-item">
            <Icon name="settings" size={18} />
            <span>设置</span>
          </button>
          <div className="user-chip">
            <span className="avatar">林</span>
            <span>
              <strong>林先生</strong>
              <small>个人账户</small>
            </span>
            <Icon name="arrow" size={15} />
          </div>
        </div>
      </aside>

      <section className="main-area">
        <header className="topbar">
          <button
            className="mobile-menu"
            aria-label="打开导航"
            onClick={() => setMobileNav((open) => !open)}
          >
            <Icon name="menu" />
          </button>
          <div className="topbar-title">{activeNav}</div>
          <div className="topbar-actions">
            <button className="icon-button" aria-label="提醒" title="提醒">
              <Icon name="bell" size={19} />
              <span className="dot" />
            </button>
            <span className="topbar-date">2026 年 8 月 5 日 · 周三</span>
            <span className="avatar small">林</span>
          </div>
        </header>
        <div className="content">
          {notice && (
            <div className="toast" role="status">
              <Icon name="check" size={16} />
              <span>{notice}</span>
              <button onClick={onDismissNotice} aria-label="关闭提示">
                <Icon name="close" size={15} />
              </button>
            </div>
          )}
          <div className="welcome-row">
            <div>
              <p className="eyebrow">WEDNESDAY, AUG 05</p>
              <h1>早上好，林先生</h1>
              <p className="subline">
                这是你的信用卡年费概览，保持进度，避免不必要的支出。
              </p>
            </div>
            <button className="primary-button" onClick={onAdd}>
              <Icon name="plus" size={17} />
              新增卡片
            </button>
          </div>

          <section className="metrics" aria-label="概览指标">
            <div className="metric">
              <span className="metric-label">卡片总数</span>
              <strong>{totalCards}</strong>
              <span className="metric-note">
                <Icon name="trend" size={14} />
                全部使用中
              </span>
            </div>
            <div className="metric">
              <span className="metric-label">本月待办</span>
              <strong>4</strong>
              <span className="metric-note warning">
                <Icon name="clock" size={14} />2 个即将到期
              </span>
            </div>
            <div className="metric">
              <span className="metric-label">未来 90 天年费</span>
              <strong>¥11,200</strong>
              <span className="metric-note">共 3 张卡</span>
            </div>
            <div className="metric accent">
              <span className="metric-label">预计节省年费</span>
              <strong>¥8,400</strong>
              <span className="metric-note success">
                <Icon name="check" size={14} />
                达成率 75%
              </span>
            </div>
          </section>

          <div className="dashboard-grid">
            <div className="primary-column">
              <section className="section-block">
                <div className="section-heading">
                  <div>
                    <p className="section-kicker">YOUR CARDS</p>
                    <h2>
                      我的卡片 <span>{totalCards}</span>
                    </h2>
                  </div>
                  <button className="text-button" onClick={onAdd}>
                    管理卡片 <Icon name="arrow" size={15} />
                  </button>
                </div>
                <div className="toolbar">
                  <label className="search-field">
                    <Icon name="search" size={16} />
                    <input
                      value={query}
                      onChange={(event) => onQueryChange(event.target.value)}
                      placeholder="搜索银行、卡名或尾号"
                    />
                  </label>
                  <button className="filter-button">
                    全部状态 <Icon name="chevronDown" size={14} />
                  </button>
                </div>
                {cards.length ? (
                  <div className="card-list">
                    {cards.map((card) => (
                      <CardRow key={card.id} card={card} />
                    ))}
                  </div>
                ) : (
                  <EmptyState onAdd={onAdd} />
                )}
              </section>
              <section className="section-block fee-section">
                <div className="section-heading">
                  <div>
                    <p className="section-kicker">UPCOMING FEES</p>
                    <h2>近期年费</h2>
                  </div>
                  <button className="text-button">
                    查看日历 <Icon name="arrow" size={15} />
                  </button>
                </div>
                <div className="fee-list">
                  {upcoming.map((item) => (
                    <div className="fee-row" key={item.date}>
                      <div className={`date-tile ${item.tone}`}>
                        <strong>{item.date.split(" / ")[0]}</strong>
                        <span>月</span>
                      </div>
                      <div className="fee-info">
                        <strong>{item.label}</strong>
                        <span>{item.days}</span>
                      </div>
                      <strong className="fee-amount">{item.amount}</strong>
                      <button
                        className="row-arrow"
                        aria-label={`查看 ${item.label}`}
                      >
                        <Icon name="arrow" size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            </div>
            <aside className="secondary-column">
              <section className="side-panel progress-panel">
                <div className="section-heading">
                  <div>
                    <p className="section-kicker">PROGRESS</p>
                    <h2>免年费进度</h2>
                  </div>
                  <button className="more-button" aria-label="更多进度选项">
                    <Icon name="more" size={18} />
                  </button>
                </div>
                {cards.slice(0, 3).map((card) => (
                  <ProgressItem key={card.id} card={card} />
                ))}
              </section>
              <section className="side-panel reminder-panel">
                <div className="section-heading">
                  <div>
                    <p className="section-kicker">REMINDERS</p>
                    <h2>
                      最近提醒 <span>2</span>
                    </h2>
                  </div>
                  <button className="text-button">
                    全部 <Icon name="arrow" size={15} />
                  </button>
                </div>
                {reminders
                  .filter((item) => !dismissed.includes(item.title))
                  .map((item) => (
                    <div className="reminder-row" key={item.title}>
                      <span
                        className={`reminder-icon ${item.urgent ? "urgent" : ""}`}
                      >
                        <Icon
                          name={item.urgent ? "bell" : "calendar"}
                          size={15}
                        />
                      </span>
                      <div>
                        <strong>{item.title}</strong>
                        <p>{item.body}</p>
                        <small>{item.when}</small>
                      </div>
                      <button
                        className="check-button"
                        aria-label="标记完成"
                        onClick={() =>
                          setDismissed((current) => [...current, item.title])
                        }
                      >
                        <Icon name="check" size={14} />
                      </button>
                    </div>
                  ))}
              </section>
              <div className="tip-panel">
                <span className="tip-icon">
                  <Icon name="sparkles" size={18} />
                </span>
                <div>
                  <strong>小提示</strong>
                  <p>把每月还款日也加入提醒，建立完整的用卡节奏。</p>
                </div>
                <button
                  aria-label="关闭小提示"
                  onClick={(e) =>
                    e.currentTarget.closest(".tip-panel")?.remove()
                  }
                >
                  <Icon name="close" size={14} />
                </button>
              </div>
            </aside>
          </div>
        </div>
      </section>
      {addOpen && <AddCardModal onClose={onAddClose} onSubmit={onAddSubmit} />}
    </main>
  );
}

function CardRow({ card }: { card: Card }) {
  const { percent, remain } = formatProgress(card);
  return (
    <article className="card-row">
      <div className={`card-emblem ${card.color}`}>
        <Icon name="credit" size={20} />
      </div>
      <div className="card-main">
        <div className="card-title">
          <strong>{card.name}</strong>
          <span className="status-pill">{card.status}</span>
        </div>
        <span className="card-meta">
          {card.bank} · 尾号 {card.last4} · 年费日{" "}
          {card.feeDate.replaceAll("-", ".")}
        </span>
        <div className="progress-line">
          <span style={{ width: `${percent}%` }} />
          <i />
        </div>
        <div className="progress-copy">
          <span>
            {card.requirement} <b>{percent}%</b>
          </span>
          <span className={percent === 100 ? "done" : ""}>
            {percent === 100 ? "已达标" : `还差 ${remain}`}
          </span>
        </div>
      </div>
      <div className="card-fee">
        <span>年费</span>
        <strong>¥{card.annualFee.toLocaleString("zh-CN")}</strong>
      </div>
      <button className="row-arrow" aria-label={`查看 ${card.name}`}>
        <Icon name="arrow" size={17} />
      </button>
    </article>
  );
}

function ProgressItem({ card }: { card: Card }) {
  const { percent, remain } = formatProgress(card);
  return (
    <div className="progress-item">
      <div className="progress-item-head">
        <span className={`mini-dot ${card.color}`} />
        <strong>
          {card.bank} · {card.name}
        </strong>
        <span>{percent}%</span>
      </div>
      <div className="progress-track">
        <span
          className={percent === 100 ? "complete" : ""}
          style={{ width: `${percent}%` }}
        />
      </div>
      <p>{percent === 100 ? "本周期已达标" : `还差 ${remain}`}</p>
    </div>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Icon name="credit" size={27} />
      </div>
      <strong>还没有添加信用卡</strong>
      <p>记录第一张卡的年费与免年费规则，开始管理你的年度支出。</p>
      <button className="secondary-button" onClick={onAdd}>
        <Icon name="plus" size={16} />
        添加第一张卡
      </button>
    </div>
  );
}

function AddCardModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (draft: CardDraft) => void;
}) {
  const [name, setName] = useState("");
  const [bank, setBank] = useState("");
  const [last4, setLast4] = useState("");
  const [fee, setFee] = useState("");
  const [date, setDate] = useState("");
  const [ruleType, setRuleType] =
    useState<CardDraft["waiveRuleType"]>("none");
  const [targetCount, setTargetCount] = useState("");
  const [targetAmount, setTargetAmount] = useState("");
  const [customRule, setCustomRule] = useState("");
  const [error, setError] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name || !bank || !/^\d{4}$/.test(last4) || !fee || !date) {
      setError("请填写所有必填项，尾号需为 4 位数字");
      return;
    }
    const countTarget = Number(targetCount);
    const amountTarget = Number(targetAmount);
    if (ruleType === "count" && (!Number.isInteger(countTarget) || countTarget <= 0)) {
      setError("次数规则需要填写大于 0 的目标次数");
      return;
    }
    if (ruleType === "amount" && (!Number.isFinite(amountTarget) || amountTarget <= 0)) {
      setError("金额规则需要填写大于 0 的目标金额");
      return;
    }
    if (ruleType === "count_and_amount" && (!Number.isInteger(countTarget) || countTarget <= 0 || !Number.isFinite(amountTarget) || amountTarget <= 0)) {
      setError("同时满足规则需要填写次数和金额目标");
      return;
    }
    if (ruleType === "custom" && !customRule.trim()) {
      setError("自定义规则需要填写说明");
      return;
    }
    onSubmit({
      issuerName: bank,
      name,
      last4,
      annualFeeAmount: Number(fee),
      nextFeeDate: date,
      feeCycleType: "custom",
      waiveRuleType: ruleType,
      targetCount: ruleType === "count" || ruleType === "count_and_amount" ? countTarget : undefined,
      targetAmount: ruleType === "amount" || ruleType === "count_and_amount" ? amountTarget : undefined,
      customRuleText: ruleType === "custom" ? customRule.trim() : undefined,
    });
  }
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-card-title"
      >
        <div className="modal-head">
          <div>
            <p className="section-kicker">NEW CARD</p>
            <h2 id="add-card-title">新增卡片</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭">
            <Icon name="close" size={18} />
          </button>
        </div>
        <form onSubmit={submit}>
          <label>
            发卡银行 <em>*</em>
            <input
              value={bank}
              onChange={(e) => setBank(e.target.value)}
              placeholder="例如 招商银行"
            />
          </label>
          <label>
            卡片名称 <em>*</em>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如 经典白金卡"
            />
          </label>
          <div className="form-row">
            <label>
              卡号后四位 <em>*</em>
              <input
                inputMode="numeric"
                maxLength={4}
                value={last4}
                onChange={(e) => setLast4(e.target.value.replace(/\D/g, ""))}
                placeholder="0000"
              />
            </label>
            <label>
              年费金额 <em>*</em>
              <input
                inputMode="decimal"
                value={fee}
                onChange={(e) => setFee(e.target.value.replace(/[^\d.]/g, ""))}
                placeholder="0"
              />
            </label>
          </div>
          <label>
            下一次年费日 <em>*</em>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <fieldset className="rule-fieldset">
            <legend>免年费规则</legend>
            <select
              value={ruleType}
              onChange={(event) =>
                setRuleType(event.target.value as CardDraft["waiveRuleType"])
              }
            >
              <option value="none">无条件免年费</option>
              <option value="count">满足消费次数</option>
              <option value="amount">满足消费金额</option>
              <option value="count_and_amount">次数和金额同时满足</option>
              <option value="custom">自定义说明</option>
            </select>
            {(ruleType === "count" || ruleType === "count_and_amount") && (
              <label>
                目标次数
                <input
                  inputMode="numeric"
                  value={targetCount}
                  onChange={(event) =>
                    setTargetCount(event.target.value.replace(/\D/g, ""))
                  }
                  placeholder="例如 12"
                />
              </label>
            )}
            {(ruleType === "amount" || ruleType === "count_and_amount") && (
              <label>
                目标金额（元）
                <input
                  inputMode="decimal"
                  value={targetAmount}
                  onChange={(event) =>
                    setTargetAmount(event.target.value.replace(/[^\d.]/g, ""))
                  }
                  placeholder="例如 100000"
                />
              </label>
            )}
            {ruleType === "custom" && (
              <label>
                规则说明
                <textarea
                  value={customRule}
                  onChange={(event) => setCustomRule(event.target.value)}
                  placeholder="例如 每年生日月双倍积分"
                />
              </label>
            )}
          </fieldset>
          {error && <p className="form-error">{error}</p>}
          <div className="modal-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={onClose}
            >
              取消
            </button>
            <button type="submit" className="primary-button">
              保存卡片 <Icon name="arrow" size={16} />
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
