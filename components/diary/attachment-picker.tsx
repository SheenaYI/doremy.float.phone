"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ImagePlus, MessageCircle, Music2, Sparkles } from "lucide-react";
import type { DiaryAttachment } from "@/lib/diary-entry-types";
import { loadChatMessages, loadChatSessions } from "@/lib/chat-storage";
import { loadAllTracks, type MusicTrack } from "@/lib/music-storage";
import {
  getCalendarTagLabel,
  loadCalendarDayRecords,
  loadCalendarTagConfig,
} from "@/lib/calendar-day-storage";
import { storeMediaBlob } from "@/lib/media-cache-storage";
import { CalendarMediaImage } from "@/components/calendar/media-image";

type PickerTab = "chat" | "music" | "photo" | "experience";

const TABS: Array<{ id: PickerTab; label: string; icon: typeof MessageCircle }> = [
  { id: "chat", label: "聊天", icon: MessageCircle },
  { id: "music", label: "音乐", icon: Music2 },
  { id: "photo", label: "照片", icon: ImagePlus },
  { id: "experience", label: "经历", icon: Sparkles },
];

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

export function DiaryAttachmentPicker({
  characterId,
  onAdd,
  onClose,
  onNotice,
}: {
  characterId: string;
  onAdd: (attachment: DiaryAttachment) => void;
  onClose: () => void;
  onNotice?: (message: string) => void;
}) {
  const [tab, setTab] = useState<PickerTab>("chat");
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [busy, setBusy] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [chatLimit, setChatLimit] = useState(60);
  const [chatQuery, setChatQuery] = useState("");

  useEffect(() => {
    void loadAllTracks().then(setTracks).catch(() => setTracks([]));
  }, []);


  const chatSessions = useMemo(
    () => loadChatSessions()
      .filter(item => item.isGroup
        ? item.participantIds?.includes(characterId)
        : item.contactId === characterId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [characterId],
  );
  const session = useMemo(
    () => chatSessions.find(item => item.id === selectedSessionId) ?? chatSessions[0] ?? null,
    [chatSessions, selectedSessionId],
  );
  useEffect(() => {
    setSelectedSessionId(current => (
      current && chatSessions.some(item => item.id === current)
        ? current
        : chatSessions[0]?.id ?? ""
    ));
    setChatLimit(60);
    setChatQuery("");
  }, [characterId, chatSessions]);

  const allChatMessages = useMemo(
    () => session
      ? loadChatMessages(session.id)
        .filter(message => (message.role === "user" || message.role === "assistant")
          && !message.isRetracted
          && message.content.trim())
        .slice()
        .reverse()
      : [],
    [session],
  );
  const matchingChatMessages = useMemo(() => {
    const query = chatQuery.trim().toLowerCase();
    return query
      ? allChatMessages.filter(message => message.content.toLowerCase().includes(query))
      : allChatMessages;
  }, [allChatMessages, chatQuery]);
  const messages = useMemo(
    () => matchingChatMessages.slice(0, chatLimit),
    [matchingChatMessages, chatLimit],
  );
  const sharedMusic = useMemo(
    () => allChatMessages
      .filter(message => message.mediaType === "music_share" || message.mediaType === "music")
      .map(message => ({
        id: message.id,
        title: message.mediaData?.musicTitle || message.mediaData?.label || "未知歌曲",
        artist: message.mediaData?.musicArtist || "",
        coverUrl: message.mediaData?.musicCoverUrl || "",
      }))
      .slice(0, 20),
    [allChatMessages],
  );
  const experiences = useMemo(
    () => loadCalendarDayRecords("character", characterId)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 14)
      .flatMap(day => day.experiences.map(experience => ({ day, experience })))
      .slice(0, 40),
    [characterId],
  );
  const tagConfig = useMemo(() => loadCalendarTagConfig(), []);

  const uploadPhoto = async (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      onNotice?.("请选择图片文件");
      return;
    }
    setBusy(true);
    try {
      const mediaRef = await storeMediaBlob(file, file.type || "image/jpeg", "image");
      onAdd({ id: makeId("diary_attachment"), type: "photo", mediaRef, createdAt: new Date().toISOString() });
      onClose();
    } catch {
      onNotice?.("照片保存失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="diary-attachment-backdrop" onClick={onClose}>
      <section className="diary-attachment-picker" onClick={event => event.stopPropagation()}>
        <header>
          <button type="button" className="diary-icon-btn" onClick={onClose} aria-label="关闭">
            <ChevronLeft size={18} />
          </button>
          <div>
            <strong>添加纪念</strong>
            <p>从已经存在的内容里选一段，不重复保存大文件。</p>
          </div>
        </header>

        <div className="diary-attachment-tabs hide-scrollbar">
          {TABS.map(item => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                data-active={tab === item.id ? "true" : undefined}
                onClick={() => setTab(item.id)}
              >
                <Icon size={14} /> {item.label}
              </button>
            );
          })}
        </div>

        <div className="diary-attachment-body hide-scrollbar">
          {tab === "chat" ? (
            <>
              {chatSessions.length > 1 ? (
                <div className="diary-attachment-chat-sessions hide-scrollbar">
                  {chatSessions.map(item => (
                    <button
                      key={item.id}
                      type="button"
                      data-active={session?.id === item.id ? "true" : undefined}
                      onClick={() => {
                        setSelectedSessionId(item.id);
                        setChatLimit(60);
                        setChatQuery("");
                      }}
                    >
                      {item.isGroup ? `群聊 · ${item.groupName || "未命名群聊"}` : "与TA的私聊"}
                    </button>
                  ))}
                </div>
              ) : null}
              <input
                type="search"
                className="diary-attachment-chat-search"
                value={chatQuery}
                onChange={event => { setChatQuery(event.target.value); setChatLimit(60); }}
                placeholder="搜索聊天内容"
              />
              {matchingChatMessages.length === 0 ? (
                <p className="diary-attachment-empty">
                  {chatQuery.trim() ? "没有匹配的聊天记录。" : "还没有可以引用的聊天记录。"}
                </p>
              ) : messages.map(message => (
                <button
                  key={message.id}
                  type="button"
                  className="diary-attachment-chat-row"
                  onClick={() => {
                    onAdd({
                      id: makeId("diary_attachment"),
                      type: "chat",
                      sessionId: session?.id ?? "",
                      messageIds: [message.id],
                      excerpt: message.content.slice(0, 400),
                      role: message.role === "assistant" ? "assistant" : "user",
                      createdAt: new Date().toISOString(),
                    });
                    onClose();
                  }}
                >
                  <span>{message.role === "user" ? "我" : (session?.isGroup ? message.senderName || "TA" : "TA")}</span>
                  <p>{message.content}</p>
                </button>
              ))}
              {matchingChatMessages.length > messages.length ? (
                <button
                  type="button"
                  className="diary-attachment-load-more"
                  onClick={() => setChatLimit(value => value + 60)}
                >
                  再加载 {Math.min(60, matchingChatMessages.length - messages.length)} 条
                </button>
              ) : null}
            </>
          ) : null}

          {tab === "music" ? (
            tracks.length === 0 && sharedMusic.length === 0
              ? <p className="diary-attachment-empty">本地音乐库和聊天里都还没有可以引用的歌。</p>
              : (
                <>
                  {sharedMusic.length > 0 ? <p className="diary-attachment-subtitle">聊天里分享过的歌</p> : null}
                  {sharedMusic.map(song => (
                    <button
                      key={`share_${song.id}`}
                      type="button"
                      className="diary-attachment-music-row"
                      onClick={() => {
                        onAdd({
                          id: makeId("diary_attachment"),
                          type: "music",
                          title: song.title,
                          artist: song.artist,
                          coverUrl: song.coverUrl || undefined,
                          createdAt: new Date().toISOString(),
                        });
                        onClose();
                      }}
                    >
                      {song.coverUrl ? <img src={song.coverUrl} alt="" /> : <span className="diary-attachment-music-cover"><Music2 size={16} /></span>}
                      <div>
                        <strong>{song.title}</strong>
                        <em>{song.artist || "来自聊天"}</em>
                      </div>
                    </button>
                  ))}
                  {tracks.length > 0 ? <p className="diary-attachment-subtitle">本地音乐库</p> : null}
                  {tracks.slice(0, 40).map(track => (
                    <button
                      key={track.id}
                      type="button"
                      className="diary-attachment-music-row"
                      onClick={() => {
                        onAdd({
                          id: makeId("diary_attachment"),
                          type: "music",
                          title: track.title,
                          artist: track.artist,
                          coverUrl: track.coverUrl,
                          trackId: track.id,
                          createdAt: new Date().toISOString(),
                        });
                        onClose();
                      }}
                    >
                      {track.coverUrl ? <img src={track.coverUrl} alt="" /> : <span className="diary-attachment-music-cover"><Music2 size={16} /></span>}
                      <div>
                        <strong>{track.title}</strong>
                        <em>{track.artist}</em>
                      </div>
                    </button>
                  ))}
                </>
              )
          ) : null}

          {tab === "photo" ? (
            <>
              <label className="diary-attachment-photo-upload">
                <ImagePlus size={26} />
                <span>{busy ? "保存中…" : "从本地选择一张照片"}</span>
                <input type="file" accept="image/*" className="hidden" disabled={busy} onChange={event => void uploadPhoto(event.target.files?.[0] ?? null)} />
              </label>
              {experiences.some(({ experience }) => experience.images.length > 0) ? (
                <>
                  <p className="diary-attachment-subtitle">已有经历图片</p>
                  <div className="diary-attachment-experience-photos">
                    {experiences.flatMap(({ day, experience }) =>
                      experience.images.map(image => (
                        <button
                          key={`${experience.id}_${image.id}`}
                          type="button"
                          onClick={() => {
                            onAdd({
                              id: makeId("diary_attachment"),
                              type: "photo",
                              mediaRef: image.mediaRef,
                              caption: image.caption || experience.title,
                              createdAt: new Date().toISOString(),
                            });
                            onClose();
                          }}
                          title={`${day.date} ${experience.title}`}
                        >
                          <CalendarMediaImage mediaRef={image.mediaRef} alt={image.caption || experience.title} />
                        </button>
                      )),
                    ).slice(0, 12)}
                  </div>
                </>
              ) : null}
            </>
          ) : null}

          {tab === "experience" ? (
            experiences.length === 0 ? <p className="diary-attachment-empty">最近还没有可以引用的日历经历。</p> : experiences.map(({ day, experience }) => (
              <button
                key={experience.id}
                type="button"
                className="diary-attachment-experience-row"
                onClick={() => {
                  onAdd({
                    id: makeId("diary_attachment"),
                    type: "experience",
                    ownerType: "character",
                    ownerId: characterId,
                    date: day.date,
                    experienceId: experience.id,
                    title: experience.title,
                    startTime: experience.startTime,
                    note: experience.note,
                    createdAt: new Date().toISOString(),
                  });
                  onClose();
                }}
              >
                <span>{day.date}</span>
                <div>
                  <strong>{experience.title}</strong>
                  <em>{experience.startTime} · #{getCalendarTagLabel(tagConfig, "event", experience.eventTypeId)}</em>
                </div>
              </button>
            ))
          ) : null}
        </div>
      </section>
    </div>
  );
}
