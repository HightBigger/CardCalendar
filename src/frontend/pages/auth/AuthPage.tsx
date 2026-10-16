"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { ApiUser } from "../../../contracts/mvp";
import { apiJson } from "../../shared/http";
import { Icon } from "../../shared/ui";

export function AuthPage({ mode }: { mode: "login" | "register" }) {
  const registering = mode === "register";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => { setReady(true); }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setError("");
    setSubmitting(true);
    try {
      const body = registering
        ? { email, password, name: name.trim() || undefined, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai" }
        : { email, password };
      await apiJson<{ user: ApiUser }>(`/api/v1/auth/${mode}`, { method: "POST", body: JSON.stringify(body) });
      window.location.assign("/");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "暂时无法登录，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page auth-scene">
      <div className="auth-backdrop" aria-hidden="true">
        <div className="auth-art-card">
          <div className="auth-art-card-face">
            <span className="auth-art-card-mark"><Icon name="credit" size={20} /><span>Cardfolio</span></span>
            <span className="auth-art-chip" />
            <span className="auth-art-card-number">••••　••••　••••</span>
            <span className="auth-art-card-line" />
          </div>
        </div>
        <div className="auth-art-calendar">
          <div className="auth-art-calendar-head"><Icon name="calendar" size={18} /><span /><span /></div>
          <div className="auth-art-calendar-days">{Array.from({ length: 28 }, (_, day) => <i key={day} />)}</div>
          <div className="auth-art-calendar-note"><span><Icon name="check" size={12} /></span><i /><i /></div>
        </div>
      </div>
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-brand">
          <span className="brand-mark"><Icon name="credit" size={20} /></span>
          <span>Cardfolio</span>
        </div>
        {registering && <a className="auth-back" href="/login">← 返回登录</a>}
        <h1 id="auth-title">{registering ? "创建账号" : "欢迎回来"}</h1>
        <p className="auth-description">{registering ? "记下卡片，安心管理每个重要日期。" : "登录，查看你的卡片和近期事项。"}</p>
        <form method="post" onSubmit={submit} className="auth-form" aria-labelledby="auth-title" aria-busy={!ready || submitting}>
          <label htmlFor="auth-email">邮箱
            <input id="auth-email" name="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" autoComplete="username" required autoCapitalize="none" spellCheck={false} disabled={!ready || submitting} />
          </label>
          <label htmlFor="auth-password">密码
            <input id="auth-password" name="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={registering ? "设置密码，至少 8 位" : "输入密码"} autoComplete={registering ? "new-password" : "current-password"} minLength={registering ? 8 : undefined} maxLength={128} required aria-describedby={error ? "auth-error" : undefined} disabled={!ready || submitting} />
          </label>
          {registering && <label htmlFor="auth-name">称呼 <span>选填</span>
            <input id="auth-name" name="name" value={name} onChange={(event) => setName(event.target.value)} placeholder="希望怎么称呼你" autoComplete="nickname" maxLength={80} disabled={!ready || submitting} />
          </label>}
          {error && <p id="auth-error" className="form-error" role="alert">{error}</p>}
          <button className="primary-button" type="submit" disabled={!ready || submitting}>{submitting ? "处理中…" : registering ? "创建账号并进入" : "登录"}</button>
        </form>
        {!registering && <p className="auth-footer">还没有账号？<a href="/register">创建账号</a></p>}
      </section>
    </main>
  );
}
