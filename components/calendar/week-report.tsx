"use client";

import { useEffect, useMemo, useState } from "react";
import type { CalendarTagConfig } from "@/lib/calendar-day-types";
import { getCalendarDailyMoodMeta } from "@/lib/calendar-day-types";
import type { CalendarWeekStats } from "@/lib/calendar-stats";
import type { CalendarOwnerType } from "@/lib/calendar-types";
import { generateCalendarWeeklyReview } from "@/lib/calendar-week-report-engine";
import {
  loadCalendarWeeklyReview,
  loadCalendarWeeklyReviews,
  saveCalendarWeeklyReview,
} from "@/lib/calendar-week-report-storage";
import { getCalendarTagColor, getCalendarTagLabel } from "@/lib/calendar-day-storage";
import { formatMonthDay } from "@/lib/calendar-utils";
import { CalendarMediaImage } from "./media-image";

const PALETTE: Record<string, string> = {
  blue: "#5B8DEF",
  green: "#67B78A",
  amber: "#E0A34A",
  rose: "#E07A93",
  violet: "#9B7BD4",
  teal: "#55B8B0",
  slate: "#8A8F98",
  lilac: "#B39DDB",
};

function colorFor(tagConfig: CalendarTagConfig, kind: "event" | "mood", id: string): string {
  return PALETTE[getCalendarTagColor(tagConfig, kind, id)] ?? PALETTE.slate;
}

export function CalendarWeekReport({
  stats,
  tagConfig,
  ownerType,
  ownerId,
  weekStart,
  onOpenExperience,
  onNotice,
}: {
  stats: CalendarWeekStats;
  tagConfig: CalendarTagConfig;
  ownerType: CalendarOwnerType;
  ownerId: string;
  weekStart: string;
  onOpenExperience?: (date: string, experienceId: string) => void;
  onNotice?: (message: string) => void;
}) {
  const [preview, setPreview] = useState<{ ref: string; caption: string } | null>(null);
  const [review, setReview] = useState(() => loadCalendarWeeklyReview(ownerType, ownerId, weekStart));
  const [history, setHistory] = useState(() => loadCalendarWeeklyReviews(ownerType, ownerId));
  const [reviewBusy, setReviewBusy] = useState(false);

  useEffect(() => {
    setReview(loadCalendarWeeklyReview(ownerType, ownerId, weekStart));
    setHistory(loadCalendarWeeklyReviews(ownerType, ownerId));
  }, [ownerType, ownerId, weekStart]);

  const generateReview = async () => {
    if (reviewBusy) return;
    setReviewBusy(true);
    try {
      const result = await generateCalendarWeeklyReview({ ownerType, ownerId, weekStart, stats });
      if (!result.success) {
        onNotice?.(result.error);
        return;
      }
      const saved = saveCalendarWeeklyReview({ ownerType, ownerId, weekStart, summary: result.summary });
      setReview(saved);
      setHistory(loadCalendarWeeklyReviews(ownerType, ownerId));
      onNotice?.("本周回顾已生成");
    } finally {
      setReviewBusy(false);
    }
  };
  const totalEvents = Math.max(1, stats.totalExperiences);
  const donutSegments = useMemo(() => {
    let offset = 0;
    return stats.eventTypeCounts.map(item => {
      const fraction = item.count / totalEvents;
      const segment = {
        ...item,
        color: colorFor(tagConfig, "event", item.id),
        dash: fraction * 2 * Math.PI * 42,
        offset,
      };
      offset += fraction * 2 * Math.PI * 42;
      return segment;
    });
  }, [stats.eventTypeCounts, tagConfig, totalEvents]);

  const moodPoints = stats.dailyMood.map((item, index) => {
    const x = 12 + (index / 6) * 276;
    const mood = item.mood ?? 0;
    const y = 112 - ((mood - 1) / 4) * 90;
    return { ...item, x, y };
  });
  const moodSegments = moodPoints.reduce<Array<Array<{ x: number; y: number }>>>((groups, point) => {
    if (!point.mood) {
      groups.push([]);
      return groups;
    }
    if (groups.length === 0) groups.push([]);
    groups[groups.length - 1].push(point);
    return groups;
  }, []).filter(group => group.length > 0);

  const maxMatrix = Math.max(1, ...stats.eventMoodMatrix.map(item => item.total));

  return (
    <section className="calendar-report">
      <div className="calendar-report-head">
        <div>
          <span>WEEKLY REVIEW</span>
          <h3>本周数据</h3>
        </div>
        <em>{formatMonthDay(stats.dates[0])} – {formatMonthDay(stats.dates[6])}</em>
      </div>

      <div className="calendar-report-counts">
        <div>
          <strong>{stats.totalSchedules}</strong>
          <span>本周行程</span>
        </div>
        <div>
          <strong>{stats.totalExtras}</strong>
          <span>额外经历</span>
        </div>
        <div>
          <strong>{stats.totalExperiences}</strong>
          <span>已记录经历</span>
        </div>
      </div>

      <div className="calendar-report-grid">
        <div className="calendar-report-card">
          <h4>事件类型占比</h4>
          {stats.eventTypeCounts.length === 0 ? (
            <p className="calendar-report-empty">还没有已记录的经历。</p>
          ) : (
            <div className="calendar-report-donut-wrap">
              <svg viewBox="0 0 100 100" className="calendar-report-donut" role="img" aria-label="事件类型占比">
                <circle cx="50" cy="50" r="42" fill="none" stroke="var(--c-calendar-surface-2)" strokeWidth="12" />
                {donutSegments.map(segment => (
                  <circle
                    key={segment.id}
                    cx="50"
                    cy="50"
                    r="42"
                    fill="none"
                    stroke={segment.color}
                    strokeWidth="12"
                    strokeDasharray={`${segment.dash} ${2 * Math.PI * 42 - segment.dash}`}
                    strokeDashoffset={-segment.offset}
                    transform="rotate(-90 50 50)"
                  />
                ))}
              </svg>
              <div className="calendar-report-legend">
                {donutSegments.slice(0, 6).map(segment => (
                  <span key={segment.id}>
                    <i style={{ background: segment.color }} />
                    {getCalendarTagLabel(tagConfig, "event", segment.id)}
                    <em>{Math.round((segment.count / totalEvents) * 100)}%</em>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="calendar-report-card">
          <h4>每日心情变化</h4>
          <svg viewBox="0 0 300 130" className="calendar-report-line" role="img" aria-label="每日心情变化">
            <line x1="12" y1="112" x2="288" y2="112" stroke="var(--c-calendar-hair)" strokeWidth="1" />
            <line x1="12" y1="67" x2="288" y2="67" stroke="var(--c-calendar-hair)" strokeWidth="0.6" strokeDasharray="3 3" />
            <line x1="12" y1="22" x2="288" y2="22" stroke="var(--c-calendar-hair)" strokeWidth="0.6" strokeDasharray="3 3" />
            {moodSegments.map((group, index) => (
              <polyline
                key={index}
                points={group.map(point => `${point.x},${point.y}`).join(" ")}
                fill="none"
                stroke="var(--c-calendar-today)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
            {moodPoints.map(point => (
              <g key={point.date}>
                <circle
                  cx={point.x}
                  cy={point.mood ? point.y : 112}
                  r={point.mood ? 3 : 2}
                  fill={point.mood ? "var(--c-calendar-today)" : "var(--c-calendar-faint)"}
                  opacity={point.mood ? 1 : 0.4}
                />
                <text x={point.x} y="126" textAnchor="middle" fontSize="7" fill="var(--c-calendar-faint)">
                  {formatMonthDay(point.date)}
                </text>
              </g>
            ))}
          </svg>
        </div>

        <div className="calendar-report-card calendar-report-card-wide">
          <h4>不同事件对应的心情</h4>
          {stats.eventMoodMatrix.length === 0 ? (
            <p className="calendar-report-empty">还没有足够的数据。</p>
          ) : (
            <div className="calendar-report-stack">
              {stats.eventMoodMatrix.slice(0, 6).map(row => (
                <div key={row.eventTypeId} className="calendar-report-stack-row">
                  <span>{getCalendarTagLabel(tagConfig, "event", row.eventTypeId)}</span>
                  <div style={{ width: `${Math.max(8, (row.total / maxMatrix) * 100)}%` }}>
                    {Object.entries(row.moods).map(([moodId, count]) => (
                      <i
                        key={moodId}
                        style={{
                          width: `${(count / row.total) * 100}%`,
                          background: colorFor(tagConfig, "mood", moodId),
                        }}
                        title={`${getCalendarTagLabel(tagConfig, "mood", moodId)} × ${count}`}
                      />
                    ))}
                  </div>
                  <em>{row.total}</em>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="calendar-report-card">
          <h4>最忙碌的一天</h4>
          {stats.busiestDay ? (
            <div className="calendar-report-daycard">
              <strong>{formatMonthDay(stats.busiestDay.date)}</strong>
              <span>{stats.busiestDay.count} 项安排</span>
            </div>
          ) : <p className="calendar-report-empty">本周还没有安排。</p>}
        </div>

        <div className="calendar-report-card">
          <h4>最开心的一天</h4>
          {stats.happiestDay ? (
            <div className="calendar-report-daycard">
              <strong>{formatMonthDay(stats.happiestDay.date)}</strong>
              <span>{getCalendarDailyMoodMeta(stats.happiestDay.mood as 1 | 2 | 3 | 4 | 5)?.emoji} {getCalendarDailyMoodMeta(stats.happiestDay.mood as 1 | 2 | 3 | 4 | 5)?.label}</span>
            </div>
          ) : <p className="calendar-report-empty">还没有心情记录。</p>}
        </div>
      </div>

      <section className="calendar-report-ai">
        <div className="calendar-report-head">
          <div>
            <span>AI REVIEW</span>
            <h4>本周回顾</h4>
          </div>
          <button
            type="button"
            className="calendar-report-ai-btn"
            data-loading={reviewBusy ? "true" : undefined}
            disabled={reviewBusy || ownerType !== "character"}
            onClick={generateReview}
          >
            {ownerType !== "character" ? "仅角色支持" : reviewBusy ? "生成中…" : review ? "重新生成" : "生成本周回顾"}
          </button>
        </div>
        {review ? (
          <p>{review.summary}</p>
        ) : (
          <p className="calendar-report-empty">本地统计不调用 API；点按钮才会让角色写一段本周回顾。</p>
        )}
        {history.length > 1 ? (
          <details className="calendar-report-history">
            <summary>历史周报（{history.length}）</summary>
            <div>
              {history.map(item => (
                <article key={item.id}>
                  <strong>{item.weekStart}</strong>
                  <p>{item.summary}</p>
                </article>
              ))}
            </div>
          </details>
        ) : null}
      </section>

      <div className="calendar-report-gallery">
        <div className="calendar-report-head">
          <div>
            <span>PHOTO ALBUM</span>
            <h4>本周相册</h4>
          </div>
          <em>{stats.images.length} 张</em>
        </div>
        {stats.images.length === 0 ? (
          <p className="calendar-report-empty">在时间轴的经历里上传或生成图片后，会聚合到这里。</p>
        ) : (
          <div className="calendar-report-gallery-grid">
            {stats.images.map(({ experience, image }) => (
              <button
                key={image.id}
                type="button"
                className="calendar-report-gallery-item"
                onClick={() => {
                  setPreview({ ref: image.mediaRef, caption: image.caption || experience.title });
                  if (onOpenExperience) onOpenExperience(experience.date, experience.id);
                }}
              >
                <CalendarMediaImage mediaRef={image.mediaRef} alt={image.caption || experience.title} />
                <span>{image.caption || experience.title}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {preview ? (
        <div className="calendar-report-image-modal" onClick={() => setPreview(null)}>
          <div onClick={event => event.stopPropagation()}>
            <CalendarMediaImage mediaRef={preview.ref} alt={preview.caption} />
            <p>{preview.caption}</p>
            <button type="button" onClick={() => setPreview(null)}>关闭</button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
