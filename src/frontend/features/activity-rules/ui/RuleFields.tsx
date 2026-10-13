"use client";
import type {
  CatalogContent,
  CatalogTarget,
} from "../../../../contracts/activity-catalog";
import type { DateValue } from "../../../../contracts/workbench";
import { emptyReward, emptyTarget, unknownDate } from "../model/content";
export function RuleDateField({
  label,
  value,
  onChange,
  timezone = "Asia/Shanghai",
}: {
  label: string;
  value: DateValue;
  onChange: (v: DateValue) => void;
  timezone?: string;
}) {
  return (
    <label>
      {label}
      <input
        type="date"
        value={value.kind === "date" ? value.value : ""}
        onChange={(e) =>
          onChange(
            e.target.value
              ? { kind: "date", value: e.target.value, timezone }
              : unknownDate(),
          )
        }
      />
      <small>
        {value.kind === "unknown"
          ? "日期未知，保留待核对"
          : "日期口径：" + timezone}
      </small>
    </label>
  );
}
function TargetFields({
  value,
  onChange,
}: {
  value: CatalogTarget;
  onChange: (t: CatalogTarget) => void;
}) {
  return (
    <div className="catalog-fields">
      <label>
        目标关系
        <select
          value={value.kind}
          onChange={(e) =>
            onChange({
              ...value,
              kind: e.target.value as CatalogTarget["kind"],
            })
          }
        >
          <option value="count">笔数</option>
          <option value="amount">金额</option>
          <option value="count_and_amount">笔数且金额</option>
          <option value="count_or_amount">笔数或金额</option>
          <option value="custom">复杂规则原文</option>
        </select>
      </label>
      <label>
        笔数（未知留空）
        <input
          type="number"
          min="1"
          value={value.count ?? ""}
          onChange={(e) =>
            onChange({
              ...value,
              count: e.target.value ? Number(e.target.value) : null,
            })
          }
        />
      </label>
      <label>
        金额（未知留空）
        <input
          inputMode="decimal"
          value={value.amount ?? ""}
          onChange={(e) =>
            onChange({ ...value, amount: e.target.value || null })
          }
        />
      </label>
      <label>
        币种
        <input
          maxLength={3}
          value={value.currency ?? ""}
          onChange={(e) =>
            onChange({
              ...value,
              currency: e.target.value.toUpperCase() || null,
            })
          }
        />
      </label>
      <label className="catalog-wide">
        目标原文
        <textarea
          value={value.rulesText}
          onChange={(e) => onChange({ ...value, rulesText: e.target.value })}
        />
      </label>
    </div>
  );
}
export function RuleTemplateFields({
  content,
  onChange,
}: {
  content: CatalogContent;
  onChange: (c: CatalogContent) => void;
}) {
  const p = content.periodTemplate,
    tz = p.timezone ?? "Asia/Shanghai";
  const period = (patch: Partial<typeof p>) =>
    onChange({ ...content, periodTemplate: { ...p, ...patch } });
  return (
    <>
      <fieldset>
        <legend>周期刷卡目标</legend>
        <div className="catalog-fields">
          <label>
            周期类型
            <select
              value={p.type}
              onChange={(e) =>
                period({ type: e.target.value as typeof p.type })
              }
            >
              <option value="month">自然月</option>
              <option value="billing">账单周期</option>
              <option value="custom">自定义</option>
              <option value="once">全期一次</option>
            </select>
          </label>
          <label>
            时区口径（管理员核对）
            <input
              placeholder="Asia/Shanghai"
              value={p.timezone ?? ""}
              onChange={(e) => period({ timezone: e.target.value || null })}
            />
          </label>
          <label>
            计入口径
            <select
              value={p.countingBasis}
              onChange={(e) =>
                period({
                  countingBasis: e.target.value as typeof p.countingBasis,
                })
              }
            >
              <option value="unknown">待核对</option>
              <option value="occurred">交易发生</option>
              <option value="posted">入账</option>
              <option value="settled">清算</option>
            </select>
          </label>
          <label>
            首尾不足周期
            <select
              value={p.partialPolicy}
              onChange={(e) =>
                period({
                  partialPolicy: e.target.value as typeof p.partialPolicy,
                })
              }
            >
              <option value="needs_review">待核对</option>
              <option value="full_target">完整目标</option>
              <option value="source_defined">官方定义</option>
            </select>
          </label>
        </div>
        <TargetFields
          value={p.target}
          onChange={(target) => period({ target })}
        />
        <details>
          <summary>明确的周期模板（账单周期可由成员提供私人边界）</summary>
          {p.periods.map((item, i) => (
            <div className="catalog-subform" key={i}>
              <label>
                周期标识
                <input
                  value={item.periodKey}
                  onChange={(e) =>
                    period({
                      periods: p.periods.map((x, j) =>
                        i === j ? { ...x, periodKey: e.target.value } : x,
                      ),
                    })
                  }
                />
              </label>
              <div className="catalog-fields">
                <RuleDateField
                  label="周期开始"
                  value={item.start}
                  timezone={tz}
                  onChange={(start) =>
                    period({
                      periods: p.periods.map((x, j) =>
                        i === j ? { ...x, start } : x,
                      ),
                    })
                  }
                />
                <RuleDateField
                  label="周期结束"
                  value={item.end}
                  timezone={tz}
                  onChange={(end) =>
                    period({
                      periods: p.periods.map((x, j) =>
                        i === j ? { ...x, end } : x,
                      ),
                    })
                  }
                />
              </div>
              <TargetFields
                value={item.target}
                onChange={(target) =>
                  period({
                    periods: p.periods.map((x, j) =>
                      i === j ? { ...x, target } : x,
                    ),
                  })
                }
              />
              <button
                type="button"
                className="text-button"
                onClick={() =>
                  period({ periods: p.periods.filter((_, j) => j !== i) })
                }
              >
                删除周期模板
              </button>
            </div>
          ))}
          <button
            type="button"
            className="secondary-button"
            onClick={() =>
              period({
                periods: [
                  ...p.periods,
                  {
                    periodKey: "period-" + (p.periods.length + 1),
                    start: unknownDate(),
                    end: unknownDate(),
                    target: emptyTarget(),
                  },
                ],
              })
            }
          >
            添加周期模板
          </button>
        </details>
      </fieldset>
      <fieldset>
        <legend>奖励及领取</legend>
        {content.rewards.map((r, i) => {
          const update = (patch: Partial<typeof r>) =>
            onChange({
              ...content,
              rewards: content.rewards.map((x, j) =>
                j === i ? { ...x, ...patch } : x,
              ),
            });
          return (
            <div className="catalog-subform" key={r.rewardKey}>
              <div className="catalog-fields">
                <label>
                  奖励名称
                  <input
                    value={r.name}
                    onChange={(e) => update({ name: e.target.value })}
                  />
                </label>
                <label>
                  奖励类型
                  <select
                    value={r.type}
                    onChange={(e) =>
                      update({ type: e.target.value as typeof r.type })
                    }
                  >
                    <option value="cashback">返现</option>
                    <option value="points">积分</option>
                    <option value="gift">实物</option>
                    <option value="other">其他</option>
                  </select>
                </label>
                <label>
                  数量或金额（未知留空）
                  <input
                    value={r.amountOrQuantity ?? ""}
                    onChange={(e) =>
                      update({ amountOrQuantity: e.target.value || null })
                    }
                  />
                </label>
                <label>
                  单位
                  <input
                    value={r.unit ?? ""}
                    onChange={(e) => update({ unit: e.target.value || null })}
                  />
                </label>
                <label>
                  奖励范围
                  <select
                    value={r.scope}
                    onChange={(e) =>
                      update({ scope: e.target.value as typeof r.scope })
                    }
                  >
                    <option value="period">每期</option>
                    <option value="all_periods">所有周期</option>
                    <option value="overall">全期</option>
                  </select>
                </label>
                <label>
                  获得方式
                  <select
                    value={r.acquisition}
                    onChange={(e) =>
                      update({
                        acquisition: e.target.value as typeof r.acquisition,
                      })
                    }
                  >
                    <option value="unknown">待核对</option>
                    <option value="manual">主动领取</option>
                    <option value="automatic">自动发放</option>
                  </select>
                </label>
                <label className="catalog-wide">
                  获得条件
                  <textarea
                    value={r.conditionsText}
                    onChange={(e) => update({ conditionsText: e.target.value })}
                  />
                </label>
                <label>
                  领取渠道
                  <input
                    value={r.channel ?? ""}
                    onChange={(e) =>
                      update({ channel: e.target.value || null })
                    }
                  />
                </label>
                <label>
                  领取官方链接
                  <input
                    type="url"
                    value={r.officialUrl ?? ""}
                    onChange={(e) =>
                      update({ officialUrl: e.target.value || null })
                    }
                  />
                </label>
                <RuleDateField
                  label="领取开始"
                  value={r.claimStart}
                  timezone={tz}
                  onChange={(claimStart) => update({ claimStart })}
                />
                <RuleDateField
                  label="领取截止"
                  value={r.claimEnd}
                  timezone={tz}
                  onChange={(claimEnd) => update({ claimEnd })}
                />
                <RuleDateField
                  label="预计到账"
                  value={r.expectedReceipt}
                  timezone={tz}
                  onChange={(expectedReceipt) => update({ expectedReceipt })}
                />
                <label>
                  到账规则
                  <input
                    value={r.receiptRuleText}
                    onChange={(e) =>
                      update({ receiptRuleText: e.target.value })
                    }
                  />
                </label>
              </div>
              {r.scope === "overall" && (
                <>
                  <h4>全期目标</h4>
                  <TargetFields
                    value={r.overallTarget ?? emptyTarget()}
                    onChange={(overallTarget) => update({ overallTarget })}
                  />
                </>
              )}
              <button
                type="button"
                className="text-button"
                onClick={() =>
                  onChange({
                    ...content,
                    rewards: content.rewards.filter((_, j) => j !== i),
                  })
                }
              >
                删除奖励
              </button>
            </div>
          );
        })}
        <button
          type="button"
          className="secondary-button"
          onClick={() =>
            onChange({
              ...content,
              rewards: [...content.rewards, emptyReward()],
            })
          }
        >
          添加奖励
        </button>
      </fieldset>
    </>
  );
}
