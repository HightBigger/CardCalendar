"use client";

import { FormEvent, useState } from "react";
import { apiJson } from "../../components/api";
import { Icon } from "../../components/icons";

type AuthData = {
  user: {
    id: string;
    email: string;
    name?: string | null;
    timezone: string;
  };
};

export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!email || !password || (mode === "register" && !name.trim())) {
      setError("请填写所有必填项");
      return;
    }
    setSubmitting(true);
    try {
      const body =
        mode === "register"
          ? {
              email,
              password,
              name: name.trim(),
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai",
            }
          : { email, password };
      await apiJson<AuthData>(
        mode === "register" ? "/api/v1/auth/register" : "/api/v1/auth/login",
        { method: "POST", body: JSON.stringify(body) },
      );
      window.location.href = "/";
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "登录失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-brand">
          <span className="brand-mark">
            <Icon name="calendar" size={22} />
          </span>
          <h1>卡年历</h1>
          <p>信用卡年费与免年费进度管理</p>
        </div>
        <div className="auth-tabs" role="tablist">
          <button
            className={mode === "login" ? "active" : ""}
            onClick={() => setMode("login")}
            type="button"
          >
            登录
          </button>
          <button
            className={mode === "register" ? "active" : ""}
            onClick={() => setMode("register")}
            type="button"
          >
            注册
          </button>
        </div>
        <form onSubmit={submit} className="auth-form">
          {mode === "register" && (
            <label>
              称呼
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="例如 林先生"
                autoComplete="name"
              />
            </label>
          )}
          <label>
            邮箱
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
            />
          </label>
          <label>
            密码
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="至少 8 位"
              autoComplete={mode === "register" ? "new-password" : "current-password"}
            />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-button" type="submit" disabled={submitting}>
            {submitting ? "处理中..." : mode === "login" ? "登录" : "注册并进入"}
          </button>
        </form>
      </section>
    </main>
  );
}
