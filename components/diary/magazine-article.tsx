"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Trash2, X } from "lucide-react";
import type { DiaryAttachment, DiaryEntry } from "@/lib/diary-entry-types";
import { DiaryBlockView } from "./block-view";
import { DiaryAttachmentPicker } from "./attachment-picker";
import { CalendarMediaImage } from "@/components/calendar/media-image";
import {
  loadDiaryReadingPosition,
  saveDiaryReadingPosition,
} from "@/lib/diary-reading-storage";

const PAGE_GAP = 26;

function dateParts(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { day: "--", month: "---", year: "----", weekday: "" };
  return {
    day: String(date.getDate()).padStart(2, "0"),
    month: ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][date.getMonth()],
    year: String(date.getFullYear()),
    weekday: ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"][date.getDay()],
  };
}

export function DiaryMagazineArticle({
  entry,
  onClose,
  onDelete,
  onUpdateAttachments,
  onNotice,
}: {
  entry: DiaryEntry;
  onClose: () => void;
  onDelete: () => void;
  onUpdateAttachments: (attachments: DiaryAttachment[]) => void;
  onNotice?: (message: string) => void;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const flowRef = useRef<HTMLDivElement | null>(null);
  const restoredRef = useRef(false);
  const lastEntryRef = useRef<string | null>(null);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const [page, setPage] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [pageWidth, setPageWidth] = useState(0);
  const [fallback, setFallback] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const date = dateParts(entry.createdAt);
  const attachments = entry.attachments ?? [];

  const measure = () => {
    const viewport = viewportRef.current;
    const flow = flowRef.current;
    if (!viewport || !flow) return;
    const width = viewport.clientWidth;
    const height = viewport.clientHeight;
    if (width <= 0 || height <= 0) return;
    flow.style.width = `${width}px`;
    flow.style.height = `${height}px`;
    flow.style.columnWidth = `${width}px`;
    flow.style.columnGap = `${PAGE_GAP}px`;
    const total = flow.scrollWidth;
    const count = Math.max(1, Math.ceil((total + PAGE_GAP) / (width + PAGE_GAP)));
    setPageWidth(width);
    setPageCount(count);
    if (count === 1 && flow.scrollHeight > height + 4) {
      setFallback(true);
      flow.style.height = "auto";
      flow.style.columnWidth = "auto";
    } else {
      setFallback(false);
    }
    if (!restoredRef.current) {
      restoredRef.current = true;
      const saved = loadDiaryReadingPosition(entry.id);
      setPage(saved ? Math.min(Math.max(0, saved.page), count - 1) : 0);
    } else {
      setPage(current => Math.min(current, count - 1));
    }
  };

  useEffect(() => {
    const changedEntry = lastEntryRef.current !== entry.id;
    lastEntryRef.current = entry.id;
    if (changedEntry) {
      restoredRef.current = false;
      setPage(0);
      setPageCount(1);
    }
    const raf = requestAnimationFrame(measure);
    const observer = new ResizeObserver(() => measure());
    if (viewportRef.current) observer.observe(viewportRef.current);
    const onFonts = () => measure();
    if (typeof document !== "undefined" && document.fonts?.ready) {
      void document.fonts.ready.then(onFonts).catch(() => undefined);
    }
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.id, entry.updatedAt, entry.attachments]);

  useEffect(() => {
    saveDiaryReadingPosition(entry.id, page, pageCount);
  }, [entry.id, page, pageCount]);

  const go = (next: number) => {
    if (fallback) return;
    setPage(Math.max(0, Math.min(pageCount - 1, next)));
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (fallback) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, input, textarea, a")) return;
    pointerRef.current = { x: event.clientX, y: event.clientY };
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pointerRef.current || fallback) return;
    const dx = event.clientX - pointerRef.current.x;
    const dy = event.clientY - pointerRef.current.y;
    pointerRef.current = null;
    if (Math.abs(dx) < 42 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
    go(dx < 0 ? page + 1 : page - 1);
  };

  return (
    <div className="diary-mag-reader">
      <header className="diary-mag-reader-head">
        <button type="button" className="diary-icon-btn" onClick={onClose} aria-label="返回目录">
          <ChevronLeft size={19} />
        </button>
        <div className="diary-mag-reader-title">
          <span>MY LIFE / {date.year}</span>
          <strong>{entry.title || "未命名手记"}</strong>
        </div>
        <button type="button" className="diary-mag-reader-delete" onClick={onDelete} aria-label="删除这篇手记">
          <Trash2 size={16} />
        </button>
      </header>

      <div
        className="diary-mag-viewport"
        ref={viewportRef}
        data-fallback={fallback ? "true" : undefined}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { pointerRef.current = null; }}
      >
        <div
          className="diary-mag-flow"
          ref={flowRef}
          style={{
            transform: fallback ? undefined : `translate3d(-${page * (pageWidth + PAGE_GAP)}px,0,0)`,
            transition: fallback ? undefined : "transform 0.34s cubic-bezier(0.22,1,0.36,1)",
          }}
        >
          <header className="diary-mag-article-head">
            <span>NOTES / {date.month} {date.year}</span>
            <div className="diary-mag-article-date">
              <b>{date.day}</b>
              <span>{date.month}<em>{date.weekday}</em></span>
            </div>
            <h1>{entry.title || "未命名手记"}</h1>
            <div className="diary-mag-article-rule" />
          </header>
          <div className="diary-mag-article-body">
            {entry.blocks.map((block, index) => (
              <DiaryBlockView key={`${block.type}-${index}`} block={block} />
            ))}
          </div>
          <footer className="diary-mag-article-signature">
            <span>{entry.characterName}</span>
            <time>{entry.dateLabel || entry.createdAt.slice(0, 10)}</time>
          </footer>
          <section className="diary-mag-related">
            <header>
              <span>RELATED MEMORIES</span>
              <button type="button" onClick={() => setPickerOpen(true)}><Plus size={12} /> 添加</button>
            </header>
            {attachments.length === 0 ? (
              <p>还可以把一段聊天、一首歌、一张照片或一条日历经历留在这里。</p>
            ) : (
              <div className="diary-mag-related-list">
                {attachments.map((attachment, index) => (
                  <article key={attachment.id}>
                    <b>{String(index + 1).padStart(2, "0")}</b>
                    <div>
                      {attachment.type === "chat" ? <blockquote>{attachment.excerpt}</blockquote> : null}
                      {attachment.type === "music" ? <strong>{attachment.title} · {attachment.artist}</strong> : null}
                      {attachment.type === "photo" ? <CalendarMediaImage mediaRef={attachment.mediaRef} alt={attachment.caption || "手记照片"} /> : null}
                      {attachment.type === "experience" ? <strong>{attachment.title} · {attachment.date}</strong> : null}
                    </div>
                    <button type="button" onClick={() => onUpdateAttachments(attachments.filter(item => item.id !== attachment.id))} aria-label="移除关联">
                      <X size={12} />
                    </button>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      {!fallback ? (
        <>
          <button type="button" className="diary-mag-page-btn diary-mag-page-prev" onClick={() => go(page - 1)} disabled={page <= 0} aria-label="上一页">
            <ChevronLeft size={18} />
          </button>
          <button type="button" className="diary-mag-page-btn diary-mag-page-next" onClick={() => go(page + 1)} disabled={page >= pageCount - 1} aria-label="下一页">
            <ChevronRight size={18} />
          </button>
          <footer className="diary-mag-reader-foot">
            <span>ISSUE {date.month} / {date.year}</span>
            <div className="diary-mag-progress">
              <i style={{ width: `${pageCount > 1 ? ((page + 1) / pageCount) * 100 : 100}%` }} />
            </div>
            <span>{String(page + 1).padStart(2, "0")} / {String(pageCount).padStart(2, "0")}</span>
          </footer>
        </>
      ) : null}

      {pickerOpen ? (
        <DiaryAttachmentPicker
          characterId={entry.characterId}
          onAdd={attachment => onUpdateAttachments([...attachments, attachment])}
          onClose={() => setPickerOpen(false)}
          onNotice={onNotice}
        />
      ) : null}
    </div>
  );
}
