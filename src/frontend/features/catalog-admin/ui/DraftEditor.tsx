"use client";
import { useEffect, useState } from "react";
import type {
  CatalogContent,
  CatalogDraft,
} from "../../../../contracts/activity-catalog";
import type { BankOption } from "../../activity-catalog";
import {
  emptyCatalogContent,
  RuleTemplateFields,
  RuleDateField,
} from "../../activity-rules";
export function DraftEditor({
  initial,
  banks,
  busy,
  error,
  onSave,
  onPreview,
  latestVersion,
}: {
  initial?: CatalogDraft;
  banks: BankOption[];
  busy: boolean;
  error?: string;
  onSave: (
    content: CatalogContent,
    expectedVersion?: number,
  ) => Promise<CatalogDraft | undefined>;
  onPreview: () => void;
  latestVersion?: number;
}) {
  const [content, setContent] = useState(
      initial?.content ?? emptyCatalogContent,
    ),
    [version, setVersion] = useState(initial?.version),
    [dirty, setDirty] = useState(false);
  const change = (c: CatalogContent) => {
    setContent(c);
    setDirty(true);
  };
  useEffect(() => {
    if (!dirty) return;
    const leave = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [dirty]);
  const tz = content.periodTemplate.timezone ?? "Asia/Shanghai";
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const result = await onSave(content, version);
    if (result) {
      setVersion(result.version);
      setDirty(false);
    }
  }
  return (
    <form className="catalog-editor" onSubmit={save}>
      <fieldset disabled={busy}>
        <legend>基本信息</legend>
        <div className="catalog-fields">
          <label>
            活动名称
            <input
              value={content.name}
              onChange={(e) => change({ ...content, name: e.target.value })}
            />
          </label>
          <label>
            所属银行
            <select
              value={content.bankId ?? ""}
              onChange={(e) =>
                change({ ...content, bankId: e.target.value || null })
              }
            >
              <option value="">待核对</option>
              {banks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            活动类型
            <input
              value={content.activityType}
              onChange={(e) =>
                change({ ...content, activityType: e.target.value })
              }
            />
          </label>
          <label className="catalog-wide">
            简介
            <textarea
              value={content.summary}
              onChange={(e) => change({ ...content, summary: e.target.value })}
            />
          </label>
          <RuleDateField
            label="活动开始"
            value={content.start}
            timezone={tz}
            onChange={(start) => change({ ...content, start })}
          />
          <RuleDateField
            label="活动结束"
            value={content.end}
            timezone={tz}
            onChange={(end) => change({ ...content, end })}
          />
        </div>
      </fieldset>
      <fieldset disabled={busy}>
        <legend>参与条件</legend>
        <div className="catalog-fields">
          {(
            [
              ["cardTypesText", "适用卡种"],
              ["customerSegmentsText", "适用客群"],
              ["regionText", "地区"],
              ["channelText", "消费渠道"],
              ["exclusionsText", "排除条件"],
              ["quotaText", "名额机制"],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                placeholder="未知留空"
                value={content.conditions[key]}
                onChange={(e) =>
                  change({
                    ...content,
                    conditions: {
                      ...content.conditions,
                      [key]: e.target.value,
                    },
                  })
                }
              />
            </label>
          ))}
          <label>
            报名要求
            <select
              value={content.conditions.enrollmentRequired}
              onChange={(e) =>
                change({
                  ...content,
                  conditions: {
                    ...content.conditions,
                    enrollmentRequired: e.target
                      .value as typeof content.conditions.enrollmentRequired,
                  },
                })
              }
            >
              <option value="unknown">待核对</option>
              <option value="yes">需要报名</option>
              <option value="no">无需报名</option>
            </select>
          </label>
          <label>
            报名范围
            <select
              value={content.conditions.enrollmentScope}
              onChange={(e) =>
                change({
                  ...content,
                  conditions: {
                    ...content.conditions,
                    enrollmentScope: e.target
                      .value as typeof content.conditions.enrollmentScope,
                  },
                })
              }
            >
              <option value="unknown">待核对</option>
              <option value="participation">整个参与</option>
              <option value="period">每个周期</option>
            </select>
          </label>
          <RuleDateField
            label="报名截止"
            value={content.conditions.enrollmentDeadline}
            timezone={tz}
            onChange={(enrollmentDeadline) =>
              change({
                ...content,
                conditions: { ...content.conditions, enrollmentDeadline },
              })
            }
          />
        </div>
      </fieldset>
      <div aria-disabled={busy}>
        <RuleTemplateFields
          content={content}
          onChange={(c) => {
            if (!busy) change(c);
          }}
        />
      </div>
      <fieldset disabled={busy}>
        <legend>官方来源</legend>
        <p>
          保存草稿允许未知。发布必须有本银行官方 HTTPS
          来源、原文摘录和真实核对时间。
        </p>
        {content.sources.map((s, i) => {
          const update = (patch: Partial<typeof s>) =>
            change({
              ...content,
              sources: content.sources.map((x, j) =>
                j === i ? { ...x, ...patch } : x,
              ),
            });
          return (
            <div className="catalog-subform" key={i}>
              <label>
                官方规则链接
                <input
                  type="url"
                  value={s.url}
                  onChange={(e) => update({ url: e.target.value })}
                />
              </label>
              <label>
                原文摘录
                <textarea
                  value={s.excerpt}
                  onChange={(e) => update({ excerpt: e.target.value })}
                />
              </label>
              <label>
                来源完整度
                <select
                  value={s.completeness}
                  onChange={(e) =>
                    update({
                      completeness: e.target.value as typeof s.completeness,
                    })
                  }
                >
                  <option value="unknown">待核对</option>
                  <option value="partial">不完整</option>
                  <option value="complete">完整</option>
                </select>
              </label>
              <p>
                访问：{s.accessedAt ?? "未记录"}
                <br />
                核对：{s.verifiedAt ?? "未记录"}
              </p>
              <button
                type="button"
                className="secondary-button"
                onClick={() =>
                  update({
                    accessedAt: new Date().toISOString(),
                    verifiedAt: new Date().toISOString(),
                  })
                }
              >
                已访问并核对上述官方规则
              </button>
              <button
                type="button"
                className="text-button"
                onClick={() =>
                  change({
                    ...content,
                    sources: content.sources.filter((_, j) => i !== j),
                  })
                }
              >
                移除此来源
              </button>
            </div>
          );
        })}
        <button
          type="button"
          className="secondary-button"
          onClick={() =>
            change({
              ...content,
              sources: [
                ...content.sources,
                {
                  url: "https://",
                  excerpt: "",
                  accessedAt: null,
                  verifiedAt: null,
                  completeness: "unknown",
                },
              ],
            })
          }
        >
          添加官方来源
        </button>
      </fieldset>
      <fieldset disabled={busy}>
        <legend>其他未知项及银行取消</legend>
        {content.unknownItems.map((x, i) => (
          <div className="catalog-subform" key={i}>
            <label>
              待核对说明
              <input
                value={x.reason}
                onChange={(e) =>
                  change({
                    ...content,
                    unknownItems: content.unknownItems.map((v, j) =>
                      i === j ? { ...v, reason: e.target.value } : v,
                    ),
                  })
                }
              />
            </label>
            <label className="catalog-check">
              <input
                type="checkbox"
                checked={x.blocksExecution}
                onChange={(e) =>
                  change({
                    ...content,
                    unknownItems: content.unknownItems.map((v, j) =>
                      i === j ? { ...v, blocksExecution: e.target.checked } : v,
                    ),
                  })
                }
              />
              阻止任务执行
            </label>
          </div>
        ))}
        <button
          type="button"
          className="secondary-button"
          onClick={() =>
            change({
              ...content,
              unknownItems: [
                ...content.unknownItems,
                {
                  code: "review-" + crypto.randomUUID(),
                  field: "conditions",
                  reason: "",
                  blocksExecution: true,
                },
              ],
            })
          }
        >
          添加未知项
        </button>
        <label className="catalog-check">
          <input
            type="checkbox"
            checked={!!content.bankCancellation}
            onChange={(e) =>
              change({
                ...content,
                bankCancellation: e.target.checked
                  ? {
                      reason: "",
                      officialSourceUrl: "https://",
                      verifiedAt: new Date().toISOString(),
                    }
                  : null,
              })
            }
          />
          银行已确认取消（与目录下架分别记录）
        </label>
        {content.bankCancellation && (
          <>
            <label>
              取消原因
              <input
                value={content.bankCancellation.reason}
                onChange={(e) =>
                  change({
                    ...content,
                    bankCancellation: {
                      ...content.bankCancellation!,
                      reason: e.target.value,
                    },
                  })
                }
              />
            </label>
            <label>
              取消官方证据
              <input
                type="url"
                value={content.bankCancellation.officialSourceUrl}
                onChange={(e) =>
                  change({
                    ...content,
                    bankCancellation: {
                      ...content.bankCancellation!,
                      officialSourceUrl: e.target.value,
                    },
                  })
                }
              />
            </label>
          </>
        )}
      </fieldset>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      {version !== undefined &&
        latestVersion !== undefined &&
        version !== latestVersion && (
          <div className="catalog-notice">
            <p>
              服务器草稿版本为 {latestVersion}
              ，你的输入已保留。核对服务器内容后，可基于新版本重新提交。
            </p>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setVersion(latestVersion)}
            >
              保留输入，使用最新版本重试
            </button>
          </div>
        )}
      <div className="catalog-actions">
        <button className="primary-button" disabled={busy}>
          {busy ? "保存中…" : "保存草稿"}
        </button>
        {initial && (
          <button
            className="secondary-button"
            type="button"
            disabled={busy || dirty}
            onClick={onPreview}
          >
            预览并校验发布
          </button>
        )}
        <span role="status">
          {dirty
            ? "有未保存修改"
            : initial
              ? "草稿已保存，尚未发布"
              : "新建草稿"}
        </span>
      </div>
    </form>
  );
}
