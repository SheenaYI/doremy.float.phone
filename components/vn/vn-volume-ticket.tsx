"use client";

import { X } from "lucide-react";
import type { VnChapterMeta, VnVolume } from "@/lib/vn-types";

export function VnVolumeTicket({
  volume,
  chapters,
  onClose,
}: {
  volume: VnVolume;
  chapters: VnChapterMeta[];
  onClose: () => void;
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
