import type { CatalogAdminFilter } from "../../../../contracts/activity-catalog";
import type { BankOption } from "../model/types";
export function CatalogFilters({
  filter,
  banks,
  onChange,
  manage = false,
}: {
  filter: CatalogAdminFilter;
  banks: BankOption[];
  onChange: (f: CatalogAdminFilter) => void;
  manage?: boolean;
}) {
  return (
    <form
      className="catalog-filters"
      aria-label="活动筛选"
      onSubmit={(e) => e.preventDefault()}
    >
      <label>
        关键词
        <input
          type="search"
          placeholder="搜索活动"
          value={filter.q ?? ""}
          onChange={(e) =>
            onChange({ ...filter, q: e.target.value, cursor: undefined })
          }
        />
      </label>
      <label>
        银行
        <select
          value={filter.bankIds?.[0] ?? ""}
          onChange={(e) =>
            onChange({
              ...filter,
              bankIds: e.target.value ? [e.target.value] : [],
              cursor: undefined,
            })
          }
        >
          <option value="">全部银行</option>
          {banks.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        活动阶段
        <select
          value={filter.phase ?? (manage ? "" : "current")}
          onChange={(e) =>
            onChange({
              ...filter,
              phase:
                (e.target.value as CatalogAdminFilter["phase"]) || undefined,
              cursor: undefined,
            })
          }
        >
          {manage && <option value="">全部阶段</option>}
          <option value="current">当前未结束</option>
          <option value="upcoming">即将开始</option>
          <option value="ongoing">进行中</option>
          <option value="ended">已结束</option>
        </select>
      </label>
      {manage ? (
        <label>
          发布状态
          <select
            value={filter.publicationStatus ?? ""}
            onChange={(e) =>
              onChange({
                ...filter,
                publicationStatus:
                  (e.target.value as CatalogAdminFilter["publicationStatus"]) ||
                  undefined,
              })
            }
          >
            <option value="">全部状态</option>
            <option value="unpublished">未发布</option>
            <option value="published">已发布</option>
            <option value="withdrawn">已下架</option>
          </select>
        </label>
      ) : (
        <>
          <label>
            活动类型
            <input
              placeholder="全部类型"
              value={filter.activityTypes?.[0] ?? ""}
              onChange={(e) =>
                onChange({
                  ...filter,
                  activityTypes: e.target.value ? [e.target.value] : [],
                })
              }
            />
          </label>
          <label className="catalog-check">
            <input
              type="checkbox"
              checked={!!filter.myBanksOnly}
              onChange={(e) =>
                onChange({ ...filter, myBanksOnly: e.target.checked })
              }
            />
            我的银行
          </label>
          <label className="catalog-check">
            <input
              type="checkbox"
              checked={!!filter.joinedOnly}
              onChange={(e) =>
                onChange({ ...filter, joinedOnly: e.target.checked })
              }
            />
            已加入
          </label>
        </>
      )}
    </form>
  );
}
