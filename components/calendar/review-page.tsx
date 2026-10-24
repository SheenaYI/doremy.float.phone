"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import type { CalendarOwnerType, CalendarScheduleItem } from "@/lib/calendar-types";
import {
  CALENDAR_DAILY_MOODS,
  getCalendarDailyMoodMeta,
  type CalendarDailyMood,
  type CalendarDayRecord,
  type CalendarExperience,
  type CalendarTagConfig,
} from "@/lib/calendar-day-types";
import {
  createCalendarExperienceDraft,
  getCalendarTagLabel,
} from "@/lib/calendar-day-storage";
import { previewCalendarSingleExperience } from "@/lib/calendar-day-engine";
import { formatIsoDate, getWeekdayLabel, parseIsoDate, timeToMinutes } from "@/lib/calendar-utils";
import { CalendarViewTabs, type CalendarViewTab } from "./view-tabs";
import { CalendarExperienceEditModal } from "./experience-edit-modal";
import { CalendarWeekReport } from "./week-report";
import { CalendarMediaImage } from "./media-image";
import type { CalendarWeekStats } from "@/lib/calendar-stats";

const DAY_MS = 86400000;

function addDays(iso: string, days: number): string {
  return formatIsoDate(new Date(parseIsoDate(iso).getTime() + days * DAY_MS));
}

function nowMinutes(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function isScheduleEnded(item: CalendarScheduleItem, todayIso: string, now: number): boolean {
  if (item.date < todayIso) return true;
  if (item.date > todayIso) return false;
  const end = timeToMinutes(item.endTime);
  return !Number.isNaN(end) && end <= now;
}

export function CalendarReviewPage({
  selectedDate,
  todayIso,
  ownerType,
  ownerId,
  scheduleItems,
  dayRecord,
  tagConfig,
  holidayMap,
  weekStats,
  ownerStrip,
  activeTab,
  onTabChange,
  onBack,
  onChangeDate,
  onSaveMood,
  onSaveSummary,
  onSaveExperience,
  onDeleteExperience,
  onNotice,
}: {
  selectedDate: string;
  todayIso: string;
  ownerType: CalendarOwnerType;
  ownerId: string;
  scheduleItems: CalendarScheduleItem[];
  dayRecord: CalendarDayRecord | null;
  tagConfig: CalendarTagConfig;
  holidayMap: Map<string, string[]>;
  weekStats: CalendarWeekStats;
  ownerStrip: ReactNode;
  activeTab: CalendarViewTab;
  onTabChange: (tab: CalendarViewTab) => void;
  onBack: () => void;
  onChangeDate: (iso: string) => void;
  onSaveMood: (mood: CalendarDailyMood | null) => void;
  onSaveSummary: (input: { keywords: string[]; summary: string }) => void;
  onSaveExperience: (experience: CalendarExperience) => void;
  onDeleteExperience: (experience: CalendarExperience) => void;
  onNotice?: (message: string) => void;
}) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [editing, setEditing] = useState<CalendarExperience | null>(null);
  const [keywordsText, setKeywordsText] = useState("");
  const [summaryText, setSummaryText] = useState("");
  const [singleBusyId, setSingleBusyId] = useState<string | null>(null);
  const [now, setNow] = useState(nowMinutes);

  useEffect(() => {
    setKeywordsText((dayRecord?.keywords ?? []).join(" / "));
    setSummaryText(dayRecord?.summary ?? "");
  }, [dayRecord?.date, dayRecord?.keywords, dayRecord?.summary]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(nowMinutes()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const experiences = dayRecord?.experiences ?? [];
  const byScheduleId = useMemo(() => {
    const map = new Map<string, CalendarExperience>();
    for (const experience of experiences) {
      if (experience.linkedScheduleId) map.set(experience.linkedScheduleId, experience);
    }
    return map;
  }, [experiences]);
  const scheduleIds = useMemo(() => new Set(scheduleItems.map(item => item.id)), [scheduleItems]);
  const extras = useMemo(
    () => experiences.filter(experience =>
      experience.kind === "extra"
      || !experience.linkedScheduleId
      || !scheduleIds.has(experience.linkedScheduleId)
    ),
    [experiences, scheduleIds],
  );
  const sortedSchedule = useMemo(
    () => [...scheduleItems].sort((a, b) => a.startTime.localeCompare(b.startTime)),
    [scheduleItems],
  );

  const dateObject = parseIsoDate(selectedDate);
  const moodMeta = getCalendarDailyMoodMeta(dayRecord?.mood ?? null);

  const toggleExpanded = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openScheduleExperience = (item: CalendarScheduleItem) => {
    const existing = byScheduleId.get(item.id);
    if (existing) {
      setEditing(existing);
      return;
    }
    setEditing(createCalendarExperienceDraft({
      date: item.date,
      startTime: item.startTime,
      endTime: item.endTime,
      title: item.title,
      kind: "schedule",
      linkedScheduleId: item.id,
    }));
  };

  const generateSingleExperience = async (item: CalendarScheduleItem) => {
    if (singleBusyId) return;
    setSingleBusyId(item.id);
    try {
      const result = await previewCalendarSingleExperience({
        ownerType,
        ownerId,
        date: item.date,
        scheduleItemId: item.id,
      });
      if (!result.success) {
        onNotice?.(result.error);
        return;
      }
      setEditing(result.experience);
    } finally {
      setSingleBusyId(null);
    }
  };

  const openExtraExperience = () => {
    setEditing(createCalendarExperienceDraft({
      date: selectedDate,
      startTime: `${String(Math.floor(now / 60)).padStart(2, "0")}:${String(now % 60).padStart(2, "0")}`,
      kind: "extra",
    }));
  };

  const saveEditing = () => {
    if (!editing) return;
    if (!editing.title.trim()) {
      onNotice?.("请填写经历标题");
      return;
    }
    onSaveExperience({ ...editing, title: editing.title.trim(), note: editing.note.trim() });
    setEditing(null);
    onNotice?.("经历已保存");
  };

  const deleteEditing = () => {
    if (!editing) return;
    onDeleteExperience(editing);
    setEditing(null);
    onNotice?.("经历已删除");
  };

  const saveSummary = () => {
    const keywords = keywordsText
      .split(/[,，、/|]+/)
      .map(item => item.trim())
      .filter(Boolean)
      .slice(0, 6);
    onSaveSummary({ keywords, summary: summaryText.trim() });
    onNotice?.("今日回顾已保存");
  };

  return (
    <div className="calendar-page calendar-page-review">
      <div className="calendar-apple-topbar">
        <button type="button" className="calendar-pill-btn calendar-back-btn" onClick={onBack}>
          <ChevronLeft size={18} />
          {dateObject.getMonth() + 1}月
        </button>
        <span className="calendar-topbar-space" />
        <button type="button" className="calendar-pill-btn" onClick={() => onChangeDate(todayIso)}>
          今天
        </button>
      </div>

      {ownerStrip}
      <CalendarViewTabs active={activeTab} onChange={onTabChange} />

      <div className="calendar-review-scroll hide-scrollbar">
        <header className="calendar-review-dayhead">
          <button type="button" className="calendar-review-daynav" onClick={() => onChangeDate(addDays(selectedDate, -1))} aria-label="前一天">
            <ChevronLeft size={18} />
          </button>
          <div>
            <strong>{dateObject.getMonth() + 1}月{dateObject.getDate()}日</strong>
            <span>
              {getWeekdayLabel(selectedDate)}
              {holidayMap.get(selectedDate)?.length ? (
                <em className="calendar-review-holiday">{holidayMap.get(selectedDate)?.join(" / ")}</em>
              ) : null}
            </span>
          </div>
          <button type="button" className="calendar-review-daynav" onClick={() => onChangeDate(addDays(selectedDate, 1))} aria-label="后一天">
            <ChevronRight size={18} />
          </button>
        </header>

        <section className="calendar-review-mood-card">
          <div className="calendar-review-section-head">
            <span>今日心情</span>
            {moodMeta ? <b>{moodMeta.emoji} {moodMeta.label}</b> : <em>未设置</em>}
          </div>
          <div className="calendar-review-mood-row">
            {CALENDAR_DAILY_MOODS.map(item => (
              <button
                key={item.value}
                type="button"
                className="calendar-review-mood-btn"
                data-active={dayRecord?.mood === item.value ? "true" : undefined}
                onClick={() => onSaveMood(dayRecord?.mood === item.value ? null : item.value)}
                aria-label={`心情：${item.label}`}
              >
                <span>{item.emoji}</span>
                <em>{item.label}</em>
              </button>
            ))}
          </div>
        </section>

        <section className="calendar-review-keywords-card">
          <div className="calendar-review-section-head">
            <span>今日关键词</span>
            <em>用 / 或逗号分隔，最多 6 个</em>
          </div>
          <input
            className="calendar-review-keywords-input"
            value={keywordsText}
            onChange={event => setKeywordsText(event.target.value)}
            placeholder="忙碌 / 意外 / 惦念"
          />
        </section>

        <div className="calendar-review-timeline">
          {sortedSchedule.length === 0 && extras.length === 0 ? (
            <div className="calendar-review-empty">
              <p>这一天还没有行程或经历。</p>
              <button type="button" className="calendar-block-btn" data-variant="primary" onClick={openExtraExperience}>
                <Plus size={15} /> 记一条额外经历
              </button>
            </div>
          ) : null}

          {sortedSchedule.map(item => {
            const experience = byScheduleId.get(item.id);
            const expanded = expandedIds.has(item.id);
            const ended = isScheduleEnded(item, todayIso, now);
            return (
              <article key={item.id} className="calendar-review-entry" data-kind="schedule">
                <div className="calendar-review-entry-rail" aria-hidden="true">
                  <span className="calendar-review-dot" />
                </div>
                <div className="calendar-review-entry-body">
                  <button type="button" className="calendar-review-entry-head" onClick={() => toggleExpanded(item.id)}>
                    <time>{item.startTime}</time>
                    <strong>{item.emoji ? `${item.emoji} ` : ""}{item.title}</strong>
                    <span className="calendar-review-status" data-state={experience ? "done" : ended ? "pending" : "planned"}>
                      {experience ? "已回顾" : ended ? "待回顾" : "计划"}
                    </span>
                  </button>
                  <div className="calendar-review-entry-meta">
                    <span>{item.startTime}–{item.endTime}</span>
                    {item.location ? <span>· {item.location}</span> : null}
                  </div>
                  {experience ? (
                    <button type="button" className="calendar-review-entry-content" onClick={() => setEditing(experience)}>
                      <span className="calendar-review-entry-tags">
                        <i data-color={tagConfig.eventTypes.find(tag => tag.id === experience.eventTypeId)?.color ?? "slate"}>
                          #{getCalendarTagLabel(tagConfig, "event", experience.eventTypeId)}
                        </i>
                        <i data-color={tagConfig.moods.find(tag => tag.id === experience.moodTypeId)?.color ?? "slate"}>
                          #{getCalendarTagLabel(tagConfig, "mood", experience.moodTypeId)}
                        </i>
                      </span>
                      <p data-expanded={expanded ? "true" : undefined}>{experience.note || "还没有写具体经历。"}</p>
                      {experience.images.length > 0 ? (
                        <span className="calendar-review-entry-images">
                          {experience.images.slice(0, 3).map(image => (
                            <CalendarMediaImage key={image.id} mediaRef={image.mediaRef} alt={image.caption || experience.title} />
                          ))}
                        </span>
                      ) : null}
                      {experience.note.length > 60 ? <em>{expanded ? "收起" : "展开"}</em> : null}
                    </button>
                  ) : (
                    <div className="calendar-review-pending">
                      <button type="button" className="calendar-review-pending-main" onClick={() => openScheduleExperience(item)}>
                        {ended ? "这条行程结束了，记录一下实际经历" : "行程开始前，可以先看看安排"}
                        <span>记录经历</span>
                      </button>
                      {ended ? (
                        <button
                          type="button"
                          className="calendar-review-pending-ai"
                          disabled={singleBusyId !== null}
                          onClick={() => void generateSingleExperience(item)}
                        >
                          {singleBusyId === item.id ? "生成中…" : "AI 写这段"}
                        </button>
                      ) : null}
                    </div>
                  )}
                </div>
              </article>
            );
          })}

          {extras.map(experience => {
            const expanded = expandedIds.has(experience.id);
            const linkedMissing = experience.linkedScheduleId && !scheduleIds.has(experience.linkedScheduleId);
            return (
              <article key={experience.id} className="calendar-review-entry" data-kind="extra">
                <div className="calendar-review-entry-rail" aria-hidden="true">
                  <span className="calendar-review-diamond" />
                </div>
                <div className="calendar-review-entry-body">
                  <button type="button" className="calendar-review-entry-head" onClick={() => toggleExpanded(experience.id)}>
                    <time>{experience.startTime}</time>
                    <strong>{experience.title}</strong>
                    <span className="calendar-review-status" data-state="extra">额外</span>
                  </button>
                  <div className="calendar-review-entry-meta">
                    {experience.endTime ? <span>{experience.startTime}–{experience.endTime}</span> : <span>{experience.startTime}</span>}
                    {linkedMissing ? <span>· 关联行程已删除</span> : null}
                  </div>
                  <button type="button" className="calendar-review-entry-content" onClick={() => setEditing(experience)}>
                    <span className="calendar-review-entry-tags">
                      <i data-color={tagConfig.eventTypes.find(tag => tag.id === experience.eventTypeId)?.color ?? "slate"}>
                        #{getCalendarTagLabel(tagConfig, "event", experience.eventTypeId)}
                      </i>
                      <i data-color={tagConfig.moods.find(tag => tag.id === experience.moodTypeId)?.color ?? "slate"}>
                        #{getCalendarTagLabel(tagConfig, "mood", experience.moodTypeId)}
                      </i>
                    </span>
                    <p data-expanded={expanded ? "true" : undefined}>{experience.note || "还没有写具体经历。"}</p>
                    {experience.note.length > 60 ? <em>{expanded ? "收起" : "展开"}</em> : null}
                  </button>
                </div>
              </article>
            );
          })}
        </div>

        <section className="calendar-review-summary-card">
          <div className="calendar-review-section-head">
            <span>今日小结</span>
            <em>会用于周报；保存后视为已回顾</em>
          </div>
          <textarea
            className="calendar-review-summary-input"
            value={summaryText}
            onChange={event => setSummaryText(event.target.value)}
            placeholder="一整天都在处理麻烦事，好在晚上总算有了值得期待的事。"
            rows={4}
          />
          <div className="calendar-review-summary-actions">
            <button type="button" className="calendar-block-btn" onClick={saveSummary}>保存今日回顾</button>
            <button type="button" className="calendar-block-btn" data-variant="primary" onClick={openExtraExperience}>
              <Plus size={15} /> 额外经历
            </button>
          </div>
        </section>

        <CalendarWeekReport
          stats={weekStats}
          tagConfig={tagConfig}
          ownerType={ownerType}
          ownerId={ownerId}
          weekStart={weekStats.weekStart}
          onNotice={onNotice}
        />
      </div>

      {editing ? (
        <CalendarExperienceEditModal
          draft={editing}
          tagConfig={tagConfig}
          onChange={setEditing}
          onSave={saveEditing}
          onDelete={deleteEditing}
          onClose={() => setEditing(null)}
          ownerType={ownerType}
          characterId={ownerType === "character" ? ownerId : undefined}
        />
      ) : null}
    </div>
  );
}
