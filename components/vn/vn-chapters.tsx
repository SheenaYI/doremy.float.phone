"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Plus, BookOpen, Trash2, RotateCcw, Layers3, X } from "lucide-react";
import { loadCharacters } from "@/lib/character-storage";
import {
  createOrGetVnSession,
  createVnVolume,
  loadVnVolumes,
  startNewChapter,
  archiveChapter,
  updateChapterSummary,
  clearChapterSummary,
  loadVnMessagesForChapter,
  listOrphanVnMessageGroups,
  restoreOrphanVnMessages,
  type VnOrphanMessageGroup,
  type VnVolume,
} from "@/lib/vn-storage";
import { VnVolumeTicket } from "./vn-volume-ticket";
import { summarizeVnChapter } from "@/lib/vn-engine";

interface VnChaptersProps {
  characterId: string;
  onClose: () => void;
  onSelect: (chapterIndex: number) => void;
  vnTheme?: string;
}

// Node positions: zigzag left/right
function getNodeX(index: number): number {
  const positions = [35, 65, 30, 70, 40, 60, 25, 75];
  return positions[index % positions.length];
}

export function VnChapters({ characterId, onClose, onSelect, vnTheme }: VnChaptersProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [, forceUpdate] = useState(0);
  const [summarizing, setSummarizing] = useState<number | null>(null);
  const [confirmClearSummaryIndex, setConfirmClearSummaryIndex] = useState<number | null>(null);
  // 无主剧情（会话行丢失后剩下的消息）恢复
  const [orphanGroups, setOrphanGroups] = useState<VnOrphanMessageGroup[]>([]);
  const [restoringSessionId, setRestoringSessionId] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [summarizeTarget, setSummarizeTarget] = useState<number | null>(null);
  const [summarizeInMemory, setSummarizeInMemory] = useState(true);
  const [summarizeError, setSummarizeError] = useState("");
  const [visibleStart, setVisibleStart] = useState<number | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedChapterIds, setSelectedChapterIds] = useState<Set<string>>(() => new Set());
  const [volumeDraftOpen, setVolumeDraftOpen] = useState(false);
  const [volumeTitle, setVolumeTitle] = useState("");
  const [volumeDeleteMessages, setVolumeDeleteMessages] = useState(false);
  const [volumeInMemory, setVolumeInMemory] = useState(true);
  const [volumeError, setVolumeError] = useState("");
  const [volumeTicket, setVolumeTicket] = useState<VnVolume | null>(null);
  const [archivePromptIndex, setArchivePromptIndex] = useState<number | null>(null);
  const [volumeProcessing, setVolumeProcessing] = useState(false);
  const [volumeProgress, setVolumeProgress] = useState("");
  const [selectHintOpen, setSelectHintOpen] = useState(false);
  const [selectHintSeen, setSelectHintSeen] = useState(false);
  const [orphanChecking, setOrphanChecking] = useState(false);
  const [orphanChecked, setOrphanChecked] = useState(false);
  const [orphanNotice, setOrphanNotice] = useState("");
  const orphanNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const character = useMemo(() => {
    return loadCharacters().find((c) => c.id === characterId);
  }, [characterId]);

  const session = useMemo(() => {
    return createOrGetVnSession(characterId);
  }, [characterId]);

  // 章节实时取自存储：恢复无主剧情等操作会替换缓存里的会话对象，
  // 沿用 useMemo 里的旧引用会让星空页继续停在恢复前的空章节上。
  const chapters = createOrGetVnSession(characterId).chapters;

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setTimeout(() => setMounted(true), 100);
  }, []);

  const checkOrphans = useCallback(async () => {
    setOrphanChecking(true);
    setOrphanChecked(true);
    setRestoreError(null);
    setOrphanNotice("");
    if (orphanNoticeTimer.current) clearTimeout(orphanNoticeTimer.current);
    try {
      const groups = await listOrphanVnMessageGroups();
      setOrphanGroups(groups);
      if (groups.length === 0) {
        setOrphanNotice("没有发现无主剧情，当前数据正常。");
        orphanNoticeTimer.current = setTimeout(() => setOrphanNotice(""), 3200);
      }
    } catch (err) {
      setRestoreError(err instanceof Error ? err.message : "检查无主剧情失败");
    } finally {
      setOrphanChecking(false);
    }
  }, []);

  useEffect(() => () => {
    if (orphanNoticeTimer.current) clearTimeout(orphanNoticeTimer.current);
  }, []);

  const lastChapter = chapters.length > 0 ? chapters[chapters.length - 1] : null;
  const canCreateNewChapter = !lastChapter || lastChapter.archived;

  const handleNewChapter = useCallback(() => {
    if (!canCreateNewChapter) return;
    const index = chapters.length;
    const title = `第${numberToChinese(index + 1)}章`;
    startNewChapter(session.id, title);
    forceUpdate((n) => n + 1);
    onSelect(index);
  }, [canCreateNewChapter, chapters.length, session.id, onSelect]);

  const handleSummarize = useCallback(async (chapterIndex: number, inMemory: boolean) => {
    setSummarizing(chapterIndex);
    setSummarizeError("");
    try {
      const messages = loadVnMessagesForChapter(session.id, chapterIndex);
      if (messages.length === 0) return;
      const summary = await summarizeVnChapter(characterId, messages);
      updateChapterSummary(session.id, chapterIndex, summary, { inMemory });
      forceUpdate((n) => n + 1);
      setSummarizeTarget(null);
    } catch (err) {
      console.error("VN chapter summarization failed:", err);
      setSummarizeError(err instanceof Error ? err.message : "章节总结失败");
    } finally {
      setSummarizing(null);
    }
  }, [session.id, characterId]);

  const handleClearSummary = useCallback((chapterIndex: number) => {
    clearChapterSummary(session.id, chapterIndex);
    setConfirmClearSummaryIndex(null);
    forceUpdate((n) => n + 1);
  }, [session.id]);

  const handleRestoreOrphans = useCallback(async (group: VnOrphanMessageGroup) => {
    setRestoreError(null);
    setRestoringSessionId(group.sessionId);
    try {
      const result = await restoreOrphanVnMessages(group.sessionId, characterId);
      if (!result) {
        setRestoreError("没找到可恢复的消息，可能已被清理。");
        return;
      }
      setOrphanGroups((prev) => prev.filter((item) => item.sessionId !== group.sessionId));
      forceUpdate((n) => n + 1);
    } catch (err) {
      console.error("VN restore orphan messages failed:", err);
      setRestoreError(err instanceof Error ? err.message : "恢复失败，请重试。");
    } finally {
      setRestoringSessionId(null);
    }
  }, [characterId]);

  const liveSession = createOrGetVnSession(characterId);
  const volumes = liveSession.volumes ?? [];
  const volumeById = useMemo(() => new Map(volumes.map(volume => [volume.id, volume])), [volumes]);
  const starItems = useMemo(() => {
    type StarItem =
      | { kind: "chapter"; chapter: (typeof chapters)[number]; index: number }
      | { kind: "volume"; volume: VnVolume; chapters: Array<(typeof chapters)[number]> };
    const items: StarItem[] = [];
    const seenVolumes = new Set<string>();
    chapters.forEach((chapter, index) => {
      if (chapter.volumeId) {
        const volume = volumeById.get(chapter.volumeId);
        if (!volume || seenVolumes.has(volume.id)) return;
        seenVolumes.add(volume.id);
        items.push({
          kind: "volume",
          volume,
          chapters: chapters.filter(item => item.volumeId === volume.id),
        });
        return;
      }
      items.push({ kind: "chapter", chapter, index });
    });
    return items;
  }, [chapters, volumeById]);

  const VISIBLE_ITEMS = 12;
  const firstVisibleIndex = Math.min(
    visibleStart ?? Math.max(0, starItems.length - VISIBLE_ITEMS),
    Math.max(0, starItems.length - VISIBLE_ITEMS),
  );

  const selectedChapters = useMemo(
    () => chapters.filter(chapter => selectedChapterIds.has(chapter.id)),
    [chapters, selectedChapterIds],
  );
  const toggleChapterSelection = (chapter: (typeof chapters)[number]) => {
    if (chapter.volumeId) return;
    if (!chapter.archived) {
      setArchivePromptIndex(chapter.index);
      return;
    }
    setSelectedChapterIds(current => {
      const next = new Set(current);
      if (next.has(chapter.id)) next.delete(chapter.id);
      else next.add(chapter.id);
      return next;
    });
  };
  const openVolumeDraft = () => {
    if (selectedChapters.length === 0) return;
    const first = selectedChapters[0];
    const last = selectedChapters[selectedChapters.length - 1];
    setVolumeTitle(`旧章合册 · ${first.title}${first.id !== last.id ? ` 至 ${last.title}` : ""}`);
    setVolumeDeleteMessages(false);
    setVolumeInMemory(true);
    setVolumeError("");
    setVolumeDraftOpen(true);
  };
  const handleCreateVolume = async () => {
    if (selectedChapters.length === 0 || volumeProcessing) return;
    const ids = selectedChapters.map(chapter => chapter.id);
    setVolumeProcessing(true);
    setVolumeError("");
    try {
      // 先把未归档/未总结的章节补齐；合册读取的是补完后的 live session。
      for (const id of ids) {
        const chapter = createOrGetVnSession(characterId).chapters.find(item => item.id === id);
        if (!chapter) continue;
        if (!chapter.archived) {
          setVolumeProgress(`归档「${chapter.title}」…`);
          archiveChapter(liveSession.id, chapter.index);
        }
        const fresh = createOrGetVnSession(characterId).chapters.find(item => item.id === id);
        if (fresh && !fresh.summaryContent?.trim()) {
          setVolumeProgress(`生成「${fresh.title}」的章节总结…`);
          const messages = loadVnMessagesForChapter(liveSession.id, fresh.index);
          if (messages.length === 0) throw new Error(`「${fresh.title}」没有可总结的消息，无法合册`);
          const summary = await summarizeVnChapter(characterId, messages);
          updateChapterSummary(liveSession.id, fresh.index, summary, { inMemory: volumeInMemory });
        }
      }
      const current = createOrGetVnSession(characterId);
      const chapterList = ids
        .map(id => current.chapters.find(chapter => chapter.id === id))
        .filter((chapter): chapter is (typeof current.chapters)[number] => Boolean(chapter));
      const missing = chapterList.filter(chapter => !chapter.summaryContent?.trim());
      if (missing.length > 0) throw new Error(`这些章节没有总结：${missing.map(chapter => chapter.title).join("、")}`);
      setVolumeProgress("生成合册…");
      const summary = chapterList
        .map(chapter => `${chapter.title}：${chapter.summaryContent?.trim() ?? ""}`)
        .join("\n\n");
      const volume = createVnVolume(liveSession.id, {
        chapterIds: ids,
        title: volumeTitle,
        summary,
        deleteMessages: volumeDeleteMessages,
        summaryInMemory: volumeInMemory,
      });
      if (!volume) throw new Error("合册失败：章节状态已变化，请重试");
      setVolumeDraftOpen(false);
      setSelectMode(false);
      setSelectedChapterIds(new Set());
      setVolumeTicket(volume);
      forceUpdate(n => n + 1);
    } catch (err) {
      setVolumeError(err instanceof Error ? err.message : "合册失败");
    } finally {
      setVolumeProcessing(false);
      setVolumeProgress("");
    }
  };

  const nodeSpacing = 120;
  const totalHeight = (starItems.length + 1) * nodeSpacing + 200;

  const buildPath = () => {
    const starOffset = 22;
    const points = starItems.map((_, i) => ({
      x: getNodeX(i),
      y: 80 + i * nodeSpacing - starOffset,
    }));
    if (points.length < 2) return "";
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      d += ` L ${points[i].x} ${points[i].y}`;
    }
    const lastY = points[points.length - 1].y + nodeSpacing;
    d += ` L 50 ${lastY}`;
    return d;
  };

  return (
    <div className="vnc-shell" data-vn-theme={vnTheme || "default"}>
      <style>{`
        .vnc-shell {
          position: absolute;
          inset: 0;
          background: var(--vn-bg);
          display: flex;
          flex-direction: column;
          overflow: hidden;
          font-family: "PingFang SC", "Hiragino Sans GB", "Noto Sans SC", system-ui, sans-serif;
          -webkit-user-select: none;
          user-select: none;
        }

        /* ── Starfield ── */
        .vnc-shell::before {
          content: "";
          position: absolute;
          inset: 0;
          background:
            radial-gradient(1.2px 1.2px at 12% 18%, rgba(255,255,255,0.4), transparent),
            radial-gradient(1px 1px at 28% 42%, rgba(255,255,255,0.25), transparent),
            radial-gradient(0.8px 0.8px at 45% 8%, rgba(255,255,255,0.2), transparent),
            radial-gradient(1px 1px at 62% 55%, rgba(255,255,255,0.3), transparent),
            radial-gradient(0.6px 0.6px at 78% 22%, rgba(255,255,255,0.15), transparent),
            radial-gradient(1.2px 1.2px at 88% 68%, rgba(255,255,255,0.35), transparent),
            radial-gradient(0.8px 0.8px at 8% 75%, rgba(255,255,255,0.2), transparent),
            radial-gradient(1px 1px at 55% 88%, rgba(255,255,255,0.25), transparent),
            radial-gradient(0.6px 0.6px at 35% 65%, rgba(255,255,255,0.15), transparent),
            radial-gradient(1px 1px at 72% 38%, rgba(255,255,255,0.2), transparent),
            radial-gradient(0.8px 0.8px at 18% 92%, rgba(255,255,255,0.15), transparent),
            radial-gradient(1.5px 1.5px at 92% 12%, rgba(255,255,255,0.3), transparent),
            radial-gradient(0.6px 0.6px at 42% 32%, rgba(255,255,255,0.1), transparent),
            radial-gradient(1px 1px at 5% 48%, rgba(255,255,255,0.2), transparent),
            radial-gradient(0.8px 0.8px at 68% 82%, rgba(255,255,255,0.15), transparent);
          pointer-events: none;
          z-index: 0;
          animation: vnc-twinkle 4s ease-in-out infinite alternate;
        }
        @keyframes vnc-twinkle {
          0% { opacity: 0.7; }
          100% { opacity: 1; }
        }

        /* Nebula glow */
        .vnc-shell::after {
          content: "";
          position: absolute;
          inset: 0;
          background:
            radial-gradient(circle at 25% 40%, rgba(100,60,180,0.07) 0%, transparent 50%),
            radial-gradient(circle at 75% 60%, rgba(60,100,200,0.05) 0%, transparent 50%),
            radial-gradient(circle at 50% 80%, rgba(140,80,160,0.04) 0%, transparent 40%);
          pointer-events: none;
          z-index: 0;
        }

        /* ── Top Bar ── */
        .vnc-topbar {
          position: relative;
          z-index: 10;
          display: flex;
          justify-content: space-between;
          align-items: center;
          height: var(--page-header-content-height, 42px);
          margin-top: var(--page-header-safe-top, 48px);
          padding: 1px 20px;
        }
        .vnc-btn {
          width: 36px; height: 36px; border: none; background: transparent;
          color: var(--vn-control-color); display: flex; align-items: center;
          justify-content: center; cursor: pointer; transition: all 0.2s;
        }
        .vnc-btn:active { transform: scale(0.9); color: var(--vn-ui-text-bright); }
        .vnc-header-center { text-align: center; }
        .vnc-char-name {
          font-size: calc(15px*var(--app-text-scale,1)); font-weight: 500; color: var(--vn-ui-text);
          letter-spacing: 0.12em;
        }
        .vnc-char-sub {
          font-size: calc(10px*var(--app-text-scale,1)); color: var(--vn-ui-text-dim);
          letter-spacing: 0.2em; text-transform: uppercase; margin-top: 2px;
        }

        /* ── Scroll ── */
        .vnc-scroll {
          flex: 1; overflow-y: auto; overflow-x: hidden;
          position: relative; z-index: 1; scrollbar-width: none;
        }
        .vnc-scroll::-webkit-scrollbar { display: none; }

        /* ── Canvas ── */
        .vnc-canvas {
          position: relative;
          width: 100%;
        }

        /* ── SVG lines ── */
        .vnc-svg {
          position: absolute;
          top: 0; left: 0;
          width: 100%; height: 100%;
          pointer-events: none;
          z-index: 1;
        }
        .vnc-path {
          fill: none;
          stroke: var(--vn-ui-accent-dim);
          stroke-width: 1;
          stroke-linecap: round;
          stroke-linejoin: round;
        }
        .vnc-path-glow {
          fill: none;
          stroke: var(--vn-ui-border);
          stroke-width: 4;
          stroke-linecap: round;
          stroke-linejoin: round;
          filter: blur(3px);
        }

        /* ── Star Node ── */
        .vnc-node {
          position: absolute;
          transform: translate(-50%, -50%);
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          z-index: 2;
          transition: all 0.3s;
        }
        .vnc-node:active { transform: translate(-50%, -50%) scale(0.93); }

        /* ── Star graphic ── */
        .vnc-star {
          width: 16px; height: 16px;
          position: relative;
          display: flex; align-items: center; justify-content: center;
        }
        .vnc-star-core {
          width: 6px; height: 6px;
          border-radius: 50%;
          background: #fff;
          box-shadow: 0 0 4px #fff, 0 0 8px rgba(200,180,255,0.6), 0 0 16px rgba(160,140,240,0.3);
          z-index: 3;
        }
        .vnc-star-ring {
          position: absolute;
          inset: -2px;
          border-radius: 50%;
          border: 1px solid var(--vn-ui-border);
          z-index: 2;
        }
        .vnc-star-flare {
          position: absolute;
          inset: -8px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(180,160,255,0.15) 0%, transparent 70%);
          z-index: 1;
          animation: vnc-flare 3s ease-in-out infinite alternate;
        }
        @keyframes vnc-flare {
          0% { transform: scale(0.8); opacity: 0.5; }
          100% { transform: scale(1.2); opacity: 1; }
        }
        /* Cross rays */
        .vnc-star-ray {
          position: absolute;
          background: linear-gradient(90deg, transparent, var(--vn-ui-accent-dim), transparent);
          z-index: 2;
        }
        .vnc-star-ray-h {
          width: 24px; height: 1px;
          top: 50%; left: 50%;
          transform: translate(-50%, -50%);
        }
        .vnc-star-ray-v {
          width: 1px; height: 24px;
          top: 50%; left: 50%;
          transform: translate(-50%, -50%);
        }

        /* Archived style */
        .vnc-node[data-archived="true"] .vnc-star-core {
          background: rgba(200,180,255,0.5);
          box-shadow: 0 0 4px rgba(200,180,255,0.3);
        }
        .vnc-node[data-archived="true"] .vnc-star-flare { opacity: 0.3; }

        /* ── Labels ── */
        .vnc-label { text-align: center; white-space: nowrap; }
        .vnc-chapter-title {
          font-size: calc(13px*var(--app-text-scale,1)); font-weight: 500;
          color: var(--vn-ui-text-bright); letter-spacing: 0.1em;
        }
        .vnc-chapter-sub {
          font-size: calc(11px*var(--app-text-scale,1)); color: var(--vn-ui-text-dim);
          letter-spacing: 0.06em; margin-top: 2px;
        }

        /* ── Action buttons ── */
        .vnc-actions {
          display: flex;
          gap: 6px;
          margin-top: 4px;
        }
        .vnc-action-btn {
          width: 28px; height: 28px; border-radius: 50%;
          border: 1px solid var(--vn-ui-border);
          background: var(--vn-ui-input);
          color: var(--vn-ui-text-dim);
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; transition: all 0.2s;
          font-family: inherit;
        }
        .vnc-action-btn:active {
          background: var(--vn-ui-accent-bg);
          color: var(--vn-ui-text);
        }
        .vnc-action-btn[data-loading="true"] {
          opacity: 0.4;
          pointer-events: none;
          animation: vnc-spin 1s linear infinite;
        }
        @keyframes vnc-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        /* ── New chapter ── */
        .vnc-new {
          position: absolute;
          transform: translate(-50%, -50%);
          display: flex; flex-direction: column; align-items: center; gap: 8px;
          padding: 12px; cursor: pointer; border: none; background: transparent;
          color: var(--vn-ui-text-dim); font-family: inherit; z-index: 2;
          transition: all 0.3s;
        }
        .vnc-new:active { color: var(--vn-ui-text); transform: translate(-50%, -50%) scale(0.95); }
        .vnc-new-dot {
          width: 28px; height: 28px; border-radius: 50%;
          border: 1px dashed var(--vn-ui-border);
          display: flex; align-items: center; justify-content: center;
        }
        .vnc-new-text { font-size: calc(11px*var(--app-text-scale,1)); letter-spacing: 0.1em; }

        /* ── Summary badge ── */
        .vnc-summary-badge {
          font-size: calc(9px*var(--app-text-scale,1));
          color: rgba(160,140,240,0.6);
          letter-spacing: 0.05em;
          margin-top: 2px;
        }

        /* ── 无主剧情恢复提示 ── */
        .vnc-recover {
          position: relative; z-index: 9;
          margin: 0 16px 10px;
          padding: 12px;
          border-radius: 12px;
          border: 1px solid var(--vn-ui-border);
          background: var(--vn-ui-input);
          display: flex; flex-direction: column; gap: 8px;
        }
        .vnc-recover-text {
          font-size: calc(11px*var(--app-text-scale,1));
          color: var(--vn-ui-text-dim);
          line-height: 1.6;
        }
        .vnc-recover-btn {
          display: flex; align-items: center; justify-content: center; gap: 6px;
          padding: 9px 10px; border-radius: 8px;
          border: 1px solid var(--vn-ui-border);
          background: var(--vn-ui-accent-bg);
          color: var(--vn-ui-text);
          font-size: calc(12px*var(--app-text-scale,1));
          font-family: inherit; cursor: pointer; line-height: 1.4;
        }
        .vnc-recover-btn:active { transform: scale(0.98); }
        .vnc-recover-btn:disabled { opacity: 0.5; }
        .vnc-recover-spin { animation: vnc-spin 1s linear infinite; }
        .vnc-recover-error {
          font-size: calc(11px*var(--app-text-scale,1));
          color: #ff6b6b;
          line-height: 1.5;
        }

        /* ── 清除章节记忆确认弹层 ── */
        .vnc-confirm-overlay {
          position: absolute; inset: 0; z-index: 60;
          background: rgba(0,0,0,0.55);
          display: flex; align-items: center; justify-content: center;
        }
        .vnc-confirm-card {
          width: 78%; max-width: 300px;
          background: var(--vn-bg, #141022);
          border: 1px solid var(--vn-ui-border, rgba(160,140,240,0.35));
          border-radius: 16px;
          padding: 20px 18px;
          color: var(--vn-ui-text, #fff);
          font-family: inherit;
          box-shadow: 0 12px 40px rgba(0,0,0,0.4);
        }
        .vnc-confirm-title {
          font-size: calc(15px*var(--app-text-scale,1));
          font-weight: 600;
          margin-bottom: 8px;
        }
        .vnc-confirm-desc {
          font-size: calc(12px*var(--app-text-scale,1));
          color: var(--vn-ui-text-dim, rgba(255,255,255,0.6));
          line-height: 1.6;
          margin-bottom: 18px;
        }
        .vnc-confirm-btns { display: flex; gap: 10px; }
        .vnc-confirm-btn {
          flex: 1; padding: 9px 0; border-radius: 10px;
          border: 1px solid var(--vn-ui-border, rgba(160,140,240,0.35));
          background: transparent; color: var(--vn-ui-text, #fff);
          font-size: calc(13px*var(--app-text-scale,1)); font-family: inherit;
          cursor: pointer;
        }
        .vnc-confirm-btn-danger {
          background: rgba(220,60,60,0.22);
          border-color: rgba(220,60,60,0.45);
        }
      `}</style>

      {/* ── Top Bar ── */}
      <div className="vnc-topbar">
        <button className="vnc-btn" onClick={onClose}>
          <ArrowLeft size={20} />
        </button>
        <div className="vnc-header-center">
          <div className="vnc-char-name">{character?.name ?? "角色"}</div>
          <div className="vnc-char-sub">Story Line</div>
        </div>
        <div className="vnc-top-actions">
          <button
            className="vnc-btn"
            title="整理旧章节"
            onClick={() => {
              if (!selectMode && !selectHintSeen) {
                setSelectHintOpen(true);
                setSelectHintSeen(true);
              }
              setSelectMode(value => !value);
              setSelectedChapterIds(new Set());
            }}
          >
            <Layers3 size={18} />
          </button>
          <button className="vnc-btn" title="检查无主剧情" onClick={() => void checkOrphans()} disabled={orphanChecking}>
            <RotateCcw size={18} />
          </button>
        </div>
      </div>

      {orphanNotice ? (
        <div className="vnc-orphan-notice" role="status">{orphanNotice}</div>
      ) : null}

      {/* ── 无主剧情恢复 ── */}
      {(orphanGroups.length > 0 || (orphanChecked && restoreError)) && (
        <div className="vnc-recover">
          <div className="vnc-recover-text">
            发现 {orphanGroups.reduce((sum, item) => sum + item.messageCount, 0)} 条没有归属的剧情消息，
            可以挂回该角色（正文、选项与每轮总结完整保留，章节标题会退回「第N章」）。
          </div>
          {orphanGroups.map((group) => (
            <button
              key={group.sessionId}
              type="button"
              className="vnc-recover-btn"
              disabled={restoringSessionId !== null}
              onClick={() => void handleRestoreOrphans(group)}
            >
              <RotateCcw size={12} className={restoringSessionId === group.sessionId ? "vnc-recover-spin" : undefined} />
              {restoringSessionId === group.sessionId
                ? "恢复中…"
                : `恢复 ${group.messageCount} 条 · ${group.chapterCount} 章（${formatOrphanRange(group.firstAt, group.lastAt)}）`}
            </button>
          ))}
          {restoreError && <div className="vnc-recover-error">{restoreError}</div>}
        </div>
      )}

      {/* ── Scrollable Star Map ── */}
      <div className="vnc-scroll" ref={scrollRef}>
        <div className="vnc-canvas" style={{ height: totalHeight }}>

          {/* SVG connecting lines */}
          {starItems.length >= 2 && (
            <svg className="vnc-svg" viewBox={`0 0 100 ${totalHeight}`} preserveAspectRatio="none">
              <path className="vnc-path-glow" d={buildPath()} vectorEffect="non-scaling-stroke" />
              <path className="vnc-path" d={buildPath()} vectorEffect="non-scaling-stroke" />
            </svg>
          )}

          {firstVisibleIndex > 0 ? (
            <button
              className="vnc-load-older"
              onClick={() => setVisibleStart(Math.max(0, firstVisibleIndex - VISIBLE_ITEMS))}
            >
              加载更早章节
            </button>
          ) : null}

          {/* Chapter / volume nodes: only the latest window is mounted */}
          {starItems.slice(firstVisibleIndex).map((item, localIndex) => {
            const i = firstVisibleIndex + localIndex;
            const x = getNodeX(i);
            const y = 80 + i * nodeSpacing;
            if (item.kind === "volume") {
              return (
                <button
                  key={item.volume.id}
                  type="button"
                  className="vnc-volume-node"
                  style={{ left: `${x}%`, top: y }}
                  onClick={() => setVolumeTicket(item.volume)}
                >
                  <span className="vnc-volume-orbit" aria-hidden="true">
                    <svg viewBox="0 0 100 100" focusable="false">
                      <g className="vnc-ripple-rings">
                        <circle className="vnc-ripple-ring r1" cx="50" cy="50" r="43" />
                        <circle className="vnc-ripple-ring r2" cx="50" cy="50" r="35" />
                        <circle className="vnc-ripple-ring r3" cx="50" cy="50" r="27" />
                        <circle className="vnc-ripple-ring r4" cx="50" cy="50" r="19" />
                        <circle className="vnc-ripple-ring r5" cx="50" cy="50" r="11" />
                        <path className="vnc-ripple-arc" d="M 8 52 A 42 42 0 0 1 25 15" />
                        <path className="vnc-ripple-arc" d="M 78 18 A 36 36 0 0 1 88 46" />
                      </g>
                      <circle className="vnc-ripple-core" cx="50" cy="50" r="2.4" />
                    </svg>
                  </span>
                  <span className="vnc-volume-kicker">合册 · {item.chapters.length} 章</span>
                  <b>{item.volume.title}</b>
                  <em>{item.volume.messagesCleared ? "仅保留摘要" : "旧章归档"}</em>
                </button>
              );
            }
            const ch = item.chapter;
            const selectable = selectMode && ch.archived && !ch.volumeId;
            const selected = selectedChapterIds.has(ch.id);
            return (
              <div
                key={ch.id}
                className="vnc-node"
                data-archived={ch.archived ? "true" : undefined}
                data-selectable={selectable ? "true" : undefined}
                data-selected={selected ? "true" : undefined}
                style={{ left: `${x}%`, top: y, opacity: mounted ? 1 : 0, transition: `all 0.5s ease ${Math.min(i * 0.03, 0.45)}s` }}
                onClick={() => {
                  if (selectMode) {
                    if (selectable) toggleChapterSelection(ch);
                    return;
                  }
                  onSelect(item.index);
                }}
              >
                <div className="vnc-star">
                  <div className="vnc-star-flare" />
                  <div className="vnc-star-ring" />
                  <div className="vnc-star-ray vnc-star-ray-h" />
                  <div className="vnc-star-ray vnc-star-ray-v" />
                  <div className="vnc-star-core" />
                </div>
                <div className="vnc-label">
                  <div className="vnc-chapter-title">{ch.title}</div>
                  {ch.subtitle && <div className="vnc-chapter-sub">{ch.subtitle}</div>}
                  {ch.summaryContent && (
                    <div className="vnc-summary-badge">
                      {ch.summaryInMemory === false ? "仅上下文" : "已生成记忆"}
                    </div>
                  )}
                </div>
                {!selectMode && ch.summaryContent && (
                  <div className="vnc-actions" onClick={(e) => e.stopPropagation()}>
                    <button
                      className="vnc-action-btn"
                      title="清除本章记忆"
                      onClick={() => setConfirmClearSummaryIndex(item.index)}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                )}
                {!selectMode && ch.archived && !ch.summaryContent && (
                  <div className="vnc-actions" onClick={(e) => e.stopPropagation()}>
                    <button
                      className="vnc-action-btn"
                      title="生成全局记忆"
                      data-loading={summarizing === item.index ? "true" : undefined}
                      onClick={() => {
                        setSummarizeTarget(item.index);
                        setSummarizeInMemory(chapters[item.index]?.summaryInMemory !== false);
                        setSummarizeError("");
                      }}
                    >
                      <BookOpen size={12} />
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {/* New chapter button */}
          <button
            className="vnc-new"
            style={{
              left: "50%",
              top: 80 + starItems.length * nodeSpacing,
              opacity: canCreateNewChapter ? undefined : 0.25,
              pointerEvents: canCreateNewChapter ? undefined : "none",
            }}
            onClick={handleNewChapter}
          >
            <div className="vnc-new-dot"><Plus size={14} /></div>
            <span className="vnc-new-text">{canCreateNewChapter ? "新章节" : "请先归档当前章节"}</span>
          </button>
        </div>
      </div>

      {selectMode ? (
        <div className="vnc-select-bar">
          <span>已选 {selectedChapters.length} 章</span>
          <button type="button" onClick={() => { setSelectMode(false); setSelectedChapterIds(new Set()); }}>取消</button>
          <button
            type="button"
            className="is-primary"
            disabled={selectedChapters.length === 0}
            onClick={openVolumeDraft}
          >
            合并成册
          </button>
        </div>
      ) : null}

      {selectHintOpen ? (
        <div className="vnc-confirm-overlay" onClick={() => setSelectHintOpen(false)}>
          <article className="vnc-confirm-card" onClick={(event) => event.stopPropagation()}>
            <div className="vnc-confirm-title">选择旧章节</div>
            <div className="vnc-confirm-desc">
              直接点击章节节点即可选择；选好后点底部「合并成册」。<br />
              未归档的章节会先询问是否归档，合册时会自动补章节总结。
            </div>
            <div className="vnc-confirm-btns">
              <button className="vnc-confirm-btn" onClick={() => setSelectHintOpen(false)}>知道了</button>
            </div>
          </article>
        </div>
      ) : null}

      {archivePromptIndex !== null ? (() => {
        const chapter = chapters[archivePromptIndex];
        return (
          <div className="vnc-confirm-overlay" onClick={() => setArchivePromptIndex(null)}>
            <article className="vnc-confirm-card" onClick={(event) => event.stopPropagation()}>
              <div className="vnc-confirm-title">「{chapter?.title ?? "本章"}」还没有归档</div>
              <div className="vnc-confirm-desc">
                归档后才能加入合册。现在归档会结束该章节；合册时会自动生成章节总结。
              </div>
              <div className="vnc-confirm-btns">
                <button className="vnc-confirm-btn" onClick={() => setArchivePromptIndex(null)}>取消</button>
                <button
                  className="vnc-confirm-btn"
                  onClick={() => {
                    if (archivePromptIndex === null) return;
                    archiveChapter(liveSession.id, archivePromptIndex);
                    setSelectedChapterIds(current => {
                      const next = new Set(current);
                      const id = chapters[archivePromptIndex]?.id;
                      if (id) next.add(id);
                      return next;
                    });
                    setArchivePromptIndex(null);
                    forceUpdate(n => n + 1);
                  }}
                >
                  先归档并选择
                </button>
              </div>
            </article>
          </div>
        );
      })() : null}

      {volumeDraftOpen ? (
        <div className="vnc-confirm-overlay" onClick={() => setVolumeDraftOpen(false)}>
          <article className="vnc-confirm-card" onClick={(event) => event.stopPropagation()}>
            <div className="vnc-confirm-title">把 {selectedChapters.length} 章合成一册？</div>
            <div className="vnc-confirm-desc">
              合册只改变星空图与上下文：保留原章节序号，旧章节用合册摘要代替逐章原文。
            </div>
            <label className="vnc-volume-field">
              <span>合册标题</span>
              <input value={volumeTitle} onChange={(event) => setVolumeTitle(event.target.value)} />
            </label>
            <div className="vnc-volume-chapters">
              {selectedChapters.map(chapter => (
                <span key={chapter.id}>{chapter.title}</span>
              ))}
            </div>
            <label className="vnc-volume-check">
              <input
                type="checkbox"
                checked={volumeInMemory}
                onChange={(event) => setVolumeInMemory(event.target.checked)}
              />
              <span>合册摘要写入记忆<em>关闭后只用于 VN 上下文</em></span>
            </label>
            <label className="vnc-volume-check">
              <input
                type="checkbox"
                checked={volumeDeleteMessages}
                onChange={(event) => setVolumeDeleteMessages(event.target.checked)}
              />
              <span>删除这些章节的正文消息<em>只保留章节摘要；之后不能再回放原文</em></span>
            </label>
            {volumeProgress ? <div className="vnc-volume-progress">{volumeProgress}</div> : null}
            {volumeError ? <div className="vnc-volume-error">{volumeError}</div> : null}
            <div className="vnc-confirm-btns">
              <button className="vnc-confirm-btn" disabled={volumeProcessing} onClick={() => setVolumeDraftOpen(false)}>取消</button>
              <button className="vnc-confirm-btn" disabled={volumeProcessing} onClick={() => void handleCreateVolume()}>
                {volumeProcessing ? "处理中…" : "确认合册"}
              </button>
            </div>
          </article>
        </div>
      ) : null}

      {volumeTicket ? (
        <VnVolumeTicket
          volume={volumeTicket}
          chapters={chapters.filter(chapter => volumeTicket.chapterIds.includes(chapter.id))}
          onClose={() => setVolumeTicket(null)}
        />
      ) : null}

      {/* 生成章节总结：先选择是否写入记忆 */}
      {summarizeTarget !== null ? (() => {
        const ch = chapters[summarizeTarget];
        return (
          <div className="vnc-confirm-overlay" onClick={() => setSummarizeTarget(null)}>
            <div className="vnc-confirm-card" onClick={(e) => e.stopPropagation()}>
              <div className="vnc-confirm-title">生成「{ch?.title ?? "本章"}」的章节总结？</div>
              <label style={{ display: "flex", alignItems: "flex-start", gap: 8, margin: "10px 0", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={summarizeInMemory}
                  onChange={(event) => setSummarizeInMemory(event.target.checked)}
                  style={{ marginTop: 2, width: 15, height: 15, accentColor: "var(--vn-accent, #d8b36a)" }}
                />
                <span style={{ fontSize: 12, lineHeight: 1.5 }}>
                  将章节总结写入记忆
                  <span style={{ display: "block", fontSize: 10, opacity: 0.55 }}>
                    关闭后只用于 VN 上下文，不进入记忆时间线
                  </span>
                </span>
              </label>
              {summarizeError ? (
                <div style={{ margin: "8px 0", color: "#e59b8a", fontSize: 11, lineHeight: 1.5 }}>{summarizeError}</div>
              ) : null}
              <div className="vnc-confirm-btns">
                <button className="vnc-confirm-btn" onClick={() => setSummarizeTarget(null)}>取消</button>
                <button
                  className="vnc-confirm-btn"
                  disabled={summarizing !== null}
                  onClick={() => summarizeTarget !== null && void handleSummarize(summarizeTarget, summarizeInMemory)}
                >
                  {summarizing !== null ? "生成中…" : "生成"}
                </button>
              </div>
            </div>
          </div>
        );
      })() : null}

      {/* 清除章节记忆确认弹层 */}
      {confirmClearSummaryIndex !== null && (() => {
        const ch = chapters[confirmClearSummaryIndex];
        return (
          <div className="vnc-confirm-overlay" onClick={() => setConfirmClearSummaryIndex(null)}>
            <div className="vnc-confirm-card" onClick={(e) => e.stopPropagation()}>
              <div className="vnc-confirm-title">清除「{ch?.title ?? "本章"}」的记忆？</div>
              <div className="vnc-confirm-desc">将删除本章已生成的章节总结记忆。聊天记录与归档状态不受影响，之后可重新生成。</div>
              <div className="vnc-confirm-btns">
                <button className="vnc-confirm-btn" onClick={() => setConfirmClearSummaryIndex(null)}>取消</button>
                <button className="vnc-confirm-btn vnc-confirm-btn-danger" onClick={() => handleClearSummary(confirmClearSummaryIndex)}>清除</button>
              </div>
            </div>
          </div>
        );
      })()}

    </div>
  );
}

/** 无主剧情的日期范围，用短格式免得撑破按钮宽度。 */
function formatOrphanRange(firstAt: string, lastAt: string): string {
  const fmt = (value: string) => {
    const ms = Date.parse(value);
    if (!Number.isFinite(ms)) return "时间未知";
    const date = new Date(ms);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  };
  const start = fmt(firstAt);
  const end = fmt(lastAt);
  return start === end ? start : `${start}~${end}`;
}

function numberToChinese(n: number): string {
  const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
  if (n <= 10) return digits[n];
  if (n < 20) return `十${digits[n - 10]}`;
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return `${digits[tens]}十${ones ? digits[ones] : ""}`;
}
