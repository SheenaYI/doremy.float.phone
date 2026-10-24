"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Camera } from "lucide-react";
import type { DiaryEntry } from "@/lib/diary-entry-types";
import {
  loadDiaryArchiveCovers,
  loadDiaryArchivePositions,
  saveDiaryArchiveCover,
  saveDiaryArchivePosition,
  type DiaryArchivePosition,
} from "@/lib/diary-archive-storage";
import { loadMediaObjectUrl, storeMediaBlob } from "@/lib/media-cache-storage";

export type DiaryArchiveBook = {
  characterId: string;
  characterName: string;
  avatar: string;
  entries: DiaryEntry[];
};

const COVER_COUNT = 6;

function hashText(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "未知时间";
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
}

function defaultPosition(index: number): DiaryArchivePosition {
  return {
    x: 4 + (index % 2) * 46,
    y: 3 + Math.floor(index / 2) * 34,
  };
}

export function DiaryArchiveBoard({
  books,
  busyIds,
  onOpen,
}: {
  books: DiaryArchiveBook[];
  busyIds: string[];
  onOpen: (book: DiaryArchiveBook) => void;
}) {
  const boardRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    id: string;
    startX: number;
    startY: number;
    origin: DiaryArchivePosition;
    width: number;
    height: number;
    moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const [positions, setPositions] = useState<Record<string, DiaryArchivePosition>>(() => loadDiaryArchivePositions());
  const [covers, setCovers] = useState<Record<string, string>>(() => loadDiaryArchiveCovers());
  const fileRef = useRef<HTMLInputElement | null>(null);
  const uploadTargetRef = useRef<string | null>(null);
  const positionsRef = useRef(positions);
  positionsRef.current = positions;
  const [draggingId, setDraggingId] = useState<string | null>(null);

  useEffect(() => {
    setPositions(current => {
      const next = { ...current };
      books.forEach((book, index) => {
        if (!next[book.characterId]) next[book.characterId] = defaultPosition(index);
      });
      return next;
    });
  }, [books]);

  const rows = Math.max(2, Math.ceil(books.length / 2));
  const boardHeight = Math.max(620, rows * 230 + 80);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>, book: DiaryArchiveBook) => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    const board = boardRef.current;
    if (!board) return;
    const rect = board.getBoundingClientRect();
    const origin = positions[book.characterId] ?? defaultPosition(books.indexOf(book));
    dragRef.current = {
      id: book.characterId,
      startX: event.clientX,
      startY: event.clientY,
      origin,
      width: rect.width,
      height: rect.height,
      moved: false,
    };
    setDraggingId(book.characterId);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = ((event.clientX - drag.startX) / Math.max(1, drag.width)) * 100;
    const dy = ((event.clientY - drag.startY) / Math.max(1, drag.height)) * 100;
    if (Math.abs(event.clientX - drag.startX) > 4 || Math.abs(event.clientY - drag.startY) > 4) {
      drag.moved = true;
    }
    setPositions(current => ({
      ...current,
      [drag.id]: {
        x: Math.max(0, Math.min(82, drag.origin.x + dx)),
        y: Math.max(0, Math.min(80, drag.origin.y + dy)),
      },
    }));
  };

  const finishDrag = () => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    setDraggingId(null);
    if (!drag.moved) {
      const book = books.find(item => item.characterId === drag.id);
      if (book) {
        suppressClickRef.current = true;
        window.setTimeout(() => { suppressClickRef.current = false; }, 260);
        onOpen(book);
      }
      return;
    }
    const position = positionsRef.current[drag.id];
    if (position) saveDiaryArchivePosition(drag.id, position);
    suppressClickRef.current = true;
    window.setTimeout(() => { suppressClickRef.current = false; }, 260);
  };

  const openCoverPicker = (characterId: string) => {
    uploadTargetRef.current = characterId;
    fileRef.current?.click();
  };

  const uploadCover = async (file: File | null) => {
    const characterId = uploadTargetRef.current;
    uploadTargetRef.current = null;
    if (!file || !characterId) return;
    if (!file.type.startsWith("image/")) return;
    try {
      const mediaRef = await storeMediaBlob(file, file.type || "image/jpeg", "image");
      saveDiaryArchiveCover(characterId, mediaRef);
      setCovers(current => ({ ...current, [characterId]: mediaRef }));
    } catch {
      // ignore upload failure; keep avatar
    }
  };

  const ordered = useMemo(() => books, [books]);

  return (
    <div className="diary-archive-board" ref={boardRef} style={{ minHeight: boardHeight }}>
      <div className="diary-archive-hint">拖动封面整理档案</div>
      {ordered.map((book, index) => {
        const position = positions[book.characterId] ?? defaultPosition(index);
        const busy = busyIds.includes(book.characterId);
        const latest = book.entries[0];
        const latestDate = latest ? new Date(latest.createdAt) : new Date();
        const issue = latestDate.getMonth() + 1;
        const year = latestDate.getFullYear();
        return (
          <div
            key={book.characterId}
            className="diary-archive-item"
            data-dragging={draggingId === book.characterId ? "true" : undefined}
            style={{
              left: `${position.x}%`,
              top: `${position.y}%`,
              zIndex: draggingId === book.characterId ? 5 : 1,
              transform: `rotate(${(hashText(book.characterId) % 7) - 3}deg)`,
            }}
            onPointerDown={event => onPointerDown(event, book)}
            onPointerMove={onPointerMove}
            onPointerUp={finishDrag}
            onPointerCancel={finishDrag}
            onClick={() => {
              if (suppressClickRef.current) return;
              onOpen(book);
            }}
          >
            <button
              type="button"
              className="diary-book diary-magazine-cover"
              data-cover={hashText(book.characterId) % COVER_COUNT}
            >
              <span className="diary-mag-cover-photo" aria-hidden="true">
                <ArchiveCoverImage mediaRef={covers[book.characterId]} fallback={book.avatar} />
              </span>
              <span className="diary-mag-rule" aria-hidden="true" />
              <span className="diary-mag-kicker">PRIVATE JOURNAL</span>
              <span className="diary-mag-title">MY LIFE</span>
              <span className="diary-mag-issue">
                ISSUE <b>{String(issue).padStart(2, "0")}</b>
                <em>{year}</em>
              </span>
              <span className="diary-mag-name">{book.characterName}</span>
              <span className="diary-mag-list">
                {book.entries.slice(0, 3).map((entry, entryIndex) => (
                  <span key={entry.id}>
                    <b>{String(entryIndex + 1).padStart(2, "0")}</b>
                    <em>{entry.title || "未命名手记"}</em>
                  </span>
                ))}
              </span>
              <span className="diary-mag-foot">
                {busy ? "写入中…" : `${book.entries.length} ENTRIES`}
                {latest ? <time>{formatDate(latest.createdAt)}</time> : null}
              </span>
            </button>
            <span
              className="diary-archive-cover-edit"
              role="button"
              tabIndex={0}
              onPointerDown={event => event.stopPropagation()}
              onClick={event => { event.stopPropagation(); openCoverPicker(book.characterId); }}
              onKeyDown={event => { if (event.key === "Enter") openCoverPicker(book.characterId); }}
            >
              <Camera size={11} /> 封面
            </span>
          </div>
        );
      })}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={event => void uploadCover(event.target.files?.[0] ?? null)}
      />
    </div>
  );
}

function ArchiveCoverImage({ mediaRef, fallback }: { mediaRef?: string; fallback?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!mediaRef) {
      setSrc(null);
      return;
    }
    let alive = true;
    let objectUrl: string | null = null;
    void loadMediaObjectUrl(mediaRef).then(url => {
      if (!alive) {
        if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
        return;
      }
      objectUrl = url;
      setSrc(url);
    }).catch(() => undefined);
    return () => {
      alive = false;
      if (objectUrl?.startsWith("blob:")) URL.revokeObjectURL(objectUrl);
    };
  }, [mediaRef]);
  if (src) return <img src={src} alt="" />;
  if (fallback) return <img src={fallback} alt="" />;
  return <Bot size={20} />;
}
