"use client";
import { useState } from "react";
import { JoinActivityDialog } from "../../features/activity-catalog";
import { useSession } from "../../app/SessionBoundary";
import {
  useCatalogController,
  CatalogFilters,
  CatalogList,
  CatalogDetail,
} from "../../features/activity-catalog";
import { QueryState } from "../../shared/ui";
export function BankActivitiesPage({ id }: { id?: string }) {
  const [joining, setJoining] = useState(false),
    [joined, setJoined] = useState<string[]>([]);
  const session = useSession(),
    c = useCatalogController(session.scope, id),
    query = id ? c.detail : c.list;
  return (
    <div className="catalog-page">
      {!id && (
        <>
          <header className="catalog-heading">
            <div>
              <p className="catalog-eyebrow">CARD FOLIO / BANK ACTIVITIES</p>
              <h1>银行活动中心</h1>
              <p>查看规则，再选择自己的卡片开始跟踪。</p>
            </div>
          </header>
          <CatalogFilters
            filter={c.filter}
            banks={c.banks.data ?? []}
            onChange={c.setFilter}
          />
          <p className="catalog-muted">
            “我的银行”仅匹配本人已核对的银行关联，不代表符合活动资格。
          </p>
          <QueryState
            {...c.banks}
            hasData={!!c.banks.data}
            retry={c.banks.reload}
            label="银行"
          />
        </>
      )}
      <QueryState
        {...query}
        hasData={!!query.data}
        retry={query.reload}
        label="银行活动"
      >
        {id && c.detail.data ? (
          <CatalogDetail
            data={c.detail.data}
            timezone={session.profile.timezone}
            onJoin={() => setJoining(true)}
          />
        ) : (
          c.list.data && (
            <CatalogList
              data={c.list.data}
              timezone={session.profile.timezone}
            />
          )
        )}
      </QueryState>
      {!id && (
        <div className="catalog-actions">
          {c.filter.cursor && (
            <button
              className="secondary-button"
              onClick={() => c.setFilter({ ...c.filter, cursor: undefined })}
            >
              回到第一页
            </button>
          )}
          {c.list.meta?.nextCursor && (
            <button
              className="secondary-button"
              onClick={() =>
                c.setFilter({ ...c.filter, cursor: c.list.meta!.nextCursor! })
              }
            >
              下一页
            </button>
          )}
        </div>
      )}
      {joined.length > 0 && (
        <section className="catalog-notice" role="status">
          <h2>个人参与已保存</h2>
          {joined.map((p) => (
            <p key={p}>
              <a href={"/activities/" + p}>查看个人参与与待核对事项</a>
            </p>
          ))}
        </section>
      )}
      {joining && c.detail.data && (
        <JoinActivityDialog
          detail={c.detail.data}
          scope={session.scope}
          onClose={() => setJoining(false)}
          onJoined={(ids) => {
            setJoined(ids);
            setJoining(false);
            void c.detail.reload();
          }}
        />
      )}
    </div>
  );
}
