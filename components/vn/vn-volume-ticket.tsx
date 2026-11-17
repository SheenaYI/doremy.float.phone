"use client";

import { X } from "lucide-react";
import type { VnChapterMeta, VnVolume } from "@/lib/vn-types";

export function VnVolumeTicket({
  volume,
  chapters,
  onClose,
  onToggle,
}: {
  volume: VnVolume;
  chapters: VnChapterMeta[];
  onClose: () => void;
  /** 修改合册摘要去向；不传则只展示不可改。 */
  onToggle?: (patch: Pick<Partial<VnVolume>, "summaryInPrompt" | "summaryInMemory">) => void;
}) {
  const range = chapters.length > 0
    ? `第${Math.min(...chapters.map(chapter => chapter.index + 1))}-${Math.max(...chapters.map(chapter => chapter.index + 1))}章`
    : "";
  return (
    <div className="vnc-confirm-overlay" onClick={onClose}>
      <article className="vnc-volume-ticket" onClick={event => event.stopPropagation()}>
        <header>
          <span>ARCHIVE TICKET</span>
          <button type="button" onClick={onClose} aria-label="关闭合册"><X size={16} /></button>
        </header>
        <h2>{volume.title}</h2>
        <div className="vnc-ticket-meta">
          <span>{range}</span>
          <span>{chapters.length} 章</span>
          {volume.messagesCleared ? <em>正文已清理</em> : null}
        </div>
        <div className="vnc-ticket-perf" aria-hidden="true" />
        <p className="vnc-ticket-summary">{volume.summary || "（暂无合册摘要）"}</p>
        {onToggle ? (
          <>
            <div className="vnc-ticket-perf" aria-hidden="true" />
            <div className="vnc-ticket-flags">
              <label>
                <input
                  type="checkbox"
                  checked={volume.summaryInPrompt !== false}
                  onChange={event => onToggle({ summaryInPrompt: event.target.checked })}
                />
                <span>合册摘要进入漫卷提示词<em>关闭后这段旧剧情不再进入 VN 上下文</em></span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={volume.summaryInMemory !== false}
                  onChange={event => onToggle({ summaryInMemory: event.target.checked })}
                />
                <span>合册摘要写入记忆<em>关闭后只留档，不进入记忆时间线</em></span>
              </label>
            </div>
          </>
        ) : null}
        <div className="vnc-ticket-perf" aria-hidden="true" />
        <div className="vnc-ticket-chapters">
          {chapters.map(chapter => (
            <div key={chapter.id}>
              <b>{String(chapter.index + 1).padStart(2, "0")}</b>
              <span>{chapter.title}</span>
              <em>{chapter.messagesCleared ? "仅摘要" : chapter.summaryContent ? "已归档" : "未总结"}</em>
            </div>
          ))}
        </div>
        <footer>
          <span>漫卷 · 旧章合册</span>
          <time>{volume.createdAt.slice(0, 10)}</time>
        </footer>
      </article>
    </div>
  );
}
