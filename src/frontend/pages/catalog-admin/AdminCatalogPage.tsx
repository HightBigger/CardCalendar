"use client";
import { useState } from "react";
import type { CatalogDraft } from "../../../contracts/activity-catalog";
import { useSession } from "../../app/SessionBoundary";
import {
  useAdminCatalogController,
  DraftEditor,
  PublishPreview,
} from "../../features/catalog-admin";
import { CatalogFilters } from "../../features/activity-catalog";
import { QueryState, ModalShell } from "../../shared/ui";
import { ApiError } from "../../shared/http";
import { businessDate } from "../../shared/display/business";
export function AdminCatalogPage({ id }: { id?: string }) {
  const session = useSession(),
    c = useAdminCatalogController(session.scope, id),
    [withdraw, setWithdraw] = useState(false),
    [reason, setReason] = useState(""),
    [message, setMessage] = useState<string | null>(null);
  const data = c.detail.data;
  if (
    (c.detail.error instanceof ApiError && c.detail.error.status === 403) ||
    (c.list.error instanceof ApiError && c.list.error.status === 403)
  )
    return (
      <p className="form-error" role="alert">
        管理权限已失效，正在更新当前权限。
      </p>
    );
  return (
    <div className="catalog-page">
      <header className="catalog-heading">
        <div>
          <p className="catalog-eyebrow">CATALOG / ADMIN</p>
          <h1>
            {id === "new"
              ? "新增银行活动"
              : id
                ? "活动草稿与发布"
                : "银行活动管理"}
          </h1>
          <p>管理目录规则，成员的个人卡片与记录保持私有。</p>
        </div>
        {!id ? (
          <a className="primary-button" href="/admin/bank-activities/new">
            新增草稿
          </a>
        ) : (
          <a className="secondary-button" href="/admin/bank-activities">
            返回管理列表
          </a>
        )}
      </header>
      {message && (
        <p role="status" className="catalog-notice">
          {message}
        </p>
      )}
      {c.queued && (
        <p className="catalog-warning" role="status">
          已排队，尚未保存完成。任务：{c.queued}
          。请查看任务状态，失败后使用原意图重试。
        </p>
      )}
      {!id && (
        <>
          <CatalogFilters
            manage
            filter={c.filter}
            banks={c.banks.data ?? []}
            onChange={c.setFilter}
          />
          <QueryState
            {...c.list}
            hasData={!!c.list.data}
            retry={c.list.reload}
            label="管理目录"
          >
            {c.list.data && !c.list.data.items.length && (
              <div className="empty-state">
                <h2>还没有符合条件的活动</h2>
                <p>新建草稿或调整筛选。</p>
              </div>
            )}
            <div className="catalog-grid">
              {c.list.data?.items.map((a) => (
                <article className="catalog-tile" key={a.id}>
                  <div className="catalog-eyebrow">
                    <span>
                      {c.banks.data?.find((b) => b.id === a.bankId)?.name ??
                        "银行待核对"}
                    </span>
                    <span>
                      {
                        {
                          unpublished: "未发布",
                          published: "已发布",
                          withdrawn: "已下架",
                        }[a.publicationStatus]
                      }
                      {a.draftId && " · 有草稿"}
                    </span>
                  </div>
                  <h2>
                    <a href={"/admin/bank-activities/" + a.id}>
                      {a.name || "未命名草稿"}
                    </a>
                  </h2>
                  <p>
                    {businessDate(a.start, session.profile.timezone)} —{" "}
                    {businessDate(a.end, session.profile.timezone)}
                  </p>
                  <p>
                    {a.targetText} · {a.rewardText || "奖励待核对"}
                  </p>
                  <small>
                    最后核对：{a.lastVerifiedAt ?? "待核对"}
                    <br />
                    最近修改：{a.lastModifiedBy.displayName} · {a.updatedAt}
                  </small>
                </article>
              ))}
            </div>
            <div className="catalog-actions">
              {c.filter.cursor && (
                <button
                  className="secondary-button"
                  onClick={() =>
                    c.setFilter({ ...c.filter, cursor: undefined })
                  }
                >
                  回到第一页
                </button>
              )}
              {c.list.meta?.nextCursor && (
                <button
                  className="secondary-button"
                  onClick={() =>
                    c.setFilter({
                      ...c.filter,
                      cursor: c.list.meta!.nextCursor!,
                    })
                  }
                >
                  下一页
                </button>
              )}
            </div>
          </QueryState>
        </>
      )}
      {id === "new" && (
        <DraftEditor
          banks={c.banks.data ?? []}
          busy={c.command.busy}
          error={c.command.error}
          onPreview={() => {}}
          onSave={async (content) => {
            const result = await c.run<CatalogDraft>("", { content });
            if (result)
              window.location.assign(
                "/admin/bank-activities/" + result.catalogActivityId,
              );
            return result;
          }}
        />
      )}
      {id && id !== "new" && (
        <QueryState
          {...c.detail}
          hasData={!!data}
          retry={c.detail.reload}
          label="管理详情"
        >
          {data && (
            <>
              <section className="catalog-panel">
                <h2>{data.activity.name || "未命名草稿"}</h2>
                <p>
                  目录 v{data.activity.version} ·{" "}
                  {
                    {
                      unpublished: "未发布",
                      published: "已发布",
                      withdrawn: "已下架",
                    }[data.activity.publicationStatus]
                  }{" "}
                  · 当前发布版本 {data.releases[0]?.releaseNumber ?? "无"}
                </p>
                <div className="catalog-actions">
                  {!data.draft && (
                    <button
                      className="secondary-button"
                      disabled={c.command.busy}
                      onClick={async () => {
                        await c.run<CatalogDraft>("/" + id + "/drafts", {
                          expectedVersion: data.activity.version,
                        });
                      }}
                    >
                      建立新版草稿
                    </button>
                  )}
                  {data.activity.publicationStatus === "published" && (
                    <button
                      className="secondary-button"
                      onClick={() => setWithdraw(true)}
                    >
                      下架活动
                    </button>
                  )}
                  {data.activity.publicationStatus === "published" && (
                    <a href={"/bank-activities/" + id}>查看当前成员页面</a>
                  )}
                </div>
              </section>
              {data.draft && (
                <DraftEditor
                  key={data.draft.id}
                  initial={data.draft}
                  latestVersion={data.draft.version}
                  banks={c.banks.data ?? []}
                  busy={c.command.busy}
                  error={c.command.error}
                  onSave={async (content, expectedVersion) => {
                    const result = await c.run<CatalogDraft>(
                      "/" + id + "/drafts/" + data.draft!.id,
                      { content, expectedVersion },
                      "PATCH",
                    );
                    if (result)
                      setMessage("草稿已保存，当前成员版本保持为已发布内容。");
                    return result;
                  }}
                  onPreview={() => {
                    void c.review(data.draft!.id);
                  }}
                />
              )}
              {c.previewBusy && <p role="status">正在校验预览…</p>}
              {c.previewError && (
                <p className="form-error" role="alert">
                  {c.previewError}
                </p>
              )}
              {c.preview && (
                <PublishPreview
                  key={c.preview.contentHash}
                  preview={c.preview}
                  busy={c.command.busy}
                  onPublish={async (input) => {
                    const result = await c.run("/" + id + "/publish", input);
                    if (result) setMessage("已发布，成员可读取此不可变版本。");
                  }}
                />
              )}
              <section className="catalog-panel">
                <h2>发布历史与操作记录</h2>
                {data.releases.map((r) => (
                  <p key={r.id}>
                    发布 v{r.releaseNumber} · {r.publishedAt} · {r.changeNote}
                  </p>
                ))}
                <ol>
                  {data.history.map((h) => (
                    <li key={h.id}>
                      {h.action} · 目录 v{h.catalogVersion}
                      {h.draftVersion
                        ? " / 草稿 v" + h.draftVersion
                        : ""} · {h.occurredAt} · 操作者 {h.actorId}
                      <p>{h.note}</p>
                    </li>
                  ))}
                </ol>
              </section>
              <ModalShell
                open={withdraw}
                onClose={() => setWithdraw(false)}
                labelledBy="catalog-withdraw-title"
              >
                <header className="modal-header">
                  <h2 id="catalog-withdraw-title">下架银行活动</h2>
                  <button
                    className="icon-button"
                    aria-label="关闭下架窗口"
                    onClick={() => setWithdraw(false)}
                  >
                    ×
                  </button>
                </header>
                <div className="modal-body">
                  <p>
                    下架停止新的加入，已加入的历史版本保留；下架不表示银行取消。
                  </p>
                  <label>
                    下架原因
                    <textarea
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </label>
                  {c.command.error && (
                    <p role="alert" className="form-error">
                      {c.command.error}
                    </p>
                  )}
                  <button
                    className="primary-button"
                    disabled={c.command.busy || !reason.trim()}
                    onClick={async () => {
                      const result = await c.run("/" + id + "/withdraw", {
                        expectedVersion: data.activity.version,
                        reason,
                      });
                      if (result) {
                        setWithdraw(false);
                        setMessage("目录已下架，原发布版本及原因已保留。");
                      }
                    }}
                  >
                    确认下架
                  </button>
                </div>
              </ModalShell>
            </>
          )}
        </QueryState>
      )}
      {c.command.error && !data?.draft && (
        <p className="form-error" role="alert">
          {c.command.error}
        </p>
      )}
    </div>
  );
}
