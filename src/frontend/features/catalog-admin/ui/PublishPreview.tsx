"use client";
import { useState } from "react";
import type {
  CatalogDraftPreview,
  PublishCatalogDraftInput,
} from "../../../../contracts/activity-catalog";
import { RulesView } from "../../activity-rules";
export function PublishPreview({
  preview,
  busy,
  onPublish,
}: {
  preview: CatalogDraftPreview;
  busy: boolean;
  onPublish: (input: PublishCatalogDraftInput) => void;
}) {
  const [note, setNote] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  return (
    <section className="catalog-panel" aria-label="发布预览">
      <h2>成员视角预览 · 草稿 v{preview.draftVersion}</h2>
      <p>只有确认发布后，成员才会看到此版本。</p>
      <div className="catalog-notice">
        <h3>发布校验</h3>
        {preview.issues.length ? (
          <ul>
            {preview.issues.map((x, i) => (
              <li key={i}>
                {x.severity === "blocks_publication"
                  ? "阻止发布"
                  : x.severity === "blocks_execution"
                    ? "待核对，阻止任务执行"
                    : "提示"}
                ：{x.message}
              </li>
            ))}
          </ul>
        ) : (
          <p>发布必需信息完整。个人资格仍需成员核对。</p>
        )}
      </div>
      <h2>{preview.content.name}</h2>
      <RulesView content={preview.content} />
      <label>
        发布或更新说明
        <textarea value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <label className="catalog-check">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        我已核对本预览和未知项，确认发布该内容
      </label>
      <button
        className="primary-button"
        disabled={busy || !preview.canPublish || !confirmed || !note.trim()}
        onClick={() =>
          onPublish({
            draftId: preview.draftId,
            expectedDraftVersion: preview.draftVersion,
            expectedCatalogVersion: preview.catalogVersion,
            reviewedContentHash: preview.contentHash,
            changeNote: note,
          })
        }
      >
        确认发布
      </button>
    </section>
  );
}
