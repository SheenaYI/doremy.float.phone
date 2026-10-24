"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Check,
  ChevronLeft,
  History,
  RotateCw,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import type { CalendarOwnerType, CalendarScheduleItem } from "@/lib/calendar-types";
import type { CalendarExperience } from "@/lib/calendar-day-types";
import { CALENDAR_DAILY_MOODS, getCalendarDailyMoodMeta } from "@/lib/calendar-day-types";
import {
  CALENDAR_GENERATION_PRESETS,
  endCalendarArc,
  getCalendarRatioLabel,
  loadActiveCalendarArcs,
  loadCalendarAiConfig,
  saveCalendarAiConfig,
  saveCalendarArc,
  type CalendarAiConfig,
  type CalendarStoryArc,
} from "@/lib/calendar-ai-config";
import { previewCalendarScheduleRange } from "@/lib/calendar-engine";
import { previewCalendarDayReview, type CalendarDayReviewDraft } from "@/lib/calendar-day-engine";
import { formatIsoDate, getWeekStartIso, parseIsoDate } from "@/lib/calendar-utils";
import { Toggle } from "../ui/form";
import { CalendarViewTabs, type CalendarViewTab } from "./view-tabs";
import { CalendarProactiveSettings } from "./proactive-settings";
import { CalendarHolidaySettings } from "./holiday-settings";

export function CalendarGeneratePage({
  selectedDate,
  ownerName,
  ownerType,
  ownerId,
  isCharacter,
  ownerStrip,
  activeTab,
  onTabChange,
  onBack,
  onApplyWeekly,
  onApplyDayReview,
  onApplyDayReviewForDate,
  onOpenReview,
  onNotice,
}: {
  selectedDate: string;
  ownerName: string;
  ownerType: CalendarOwnerType;
  ownerId: string;
  isCharacter: boolean;
  ownerStrip: ReactNode;
  activeTab: CalendarViewTab;
  onTabChange: (tab: CalendarViewTab) => void;
  onBack: () => void;
  onApplyWeekly: (items: CalendarScheduleItem[], startDate: string, endDate: string) => void;
  onApplyDayReview: (review: CalendarDayReviewDraft) => void;
  onApplyDayReviewForDate: (date: string, review: CalendarDayReviewDraft) => void;
  onOpenReview: () => void;
  onNotice?: (message: string) => void;
}) {
  const [config, setConfig] = useState<CalendarAiConfig>(() => loadCalendarAiConfig(ownerType, ownerId));
  const [weeklyPreview, setWeeklyPreview] = useState<CalendarScheduleItem[] | null>(null);
  const [selectedWeekIds, setSelectedWeekIds] = useState<Set<string>>(() => new Set());
  const [reviewPreview, setReviewPreview] = useState<CalendarDayReviewDraft | null>(null);
  const [reviewKeywordsText, setReviewKeywordsText] = useState("");
  const [includeChat, setIncludeChat] = useState(false);
  const [extraHint, setExtraHint] = useState("");
  const [arcs, setArcs] = useState<CalendarStoryArc[]>(() => loadActiveCalendarArcs(ownerType, ownerId));
  const [arcTitleDraft, setArcTitleDraft] = useState("");
  const [weeklyBusy, setWeeklyBusy] = useState(false);
  const [dayBusy, setDayBusy] = useState(false);
  const [reviewStartDate, setReviewStartDate] = useState(() =>
    selectedDate <= formatIsoDate(new Date()) ? selectedDate : formatIsoDate(new Date())
  );
  const [reviewEndDate, setReviewEndDate] = useState(() =>
    selectedDate <= formatIsoDate(new Date()) ? selectedDate : formatIsoDate(new Date())
  );
  const [reviewRange, setReviewRange] = useState<Array<{ date: string; review: CalendarDayReviewDraft }>>([]);
  const [rangeBusy, setRangeBusy] = useState(false);
  const [scheduleStartDate, setScheduleStartDate] = useState(() => getWeekStartIso(parseIsoDate(selectedDate)));
  const [scheduleEndDate, setScheduleEndDate] = useState(() => formatIsoDate(new Date(parseIsoDate(getWeekStartIso(parseIsoDate(selectedDate))).getTime() + 6 * 86_400_000)));
  const weekStart = getWeekStartIso(parseIsoDate(selectedDate));
  const date = parseIsoDate(selectedDate);

  useEffect(() => {
    setConfig(loadCalendarAiConfig(ownerType, ownerId));
    setArcs(loadActiveCalendarArcs(ownerType, ownerId));
  }, [ownerType, ownerId]);

  useEffect(() => {
    setScheduleStartDate(weekStart);
    setScheduleEndDate(formatIsoDate(new Date(parseIsoDate(weekStart).getTime() + 6 * 86_400_000)));
    const today = formatIsoDate(new Date());
    const clamped = selectedDate <= today ? selectedDate : today;
    setReviewStartDate(clamped);
    setReviewEndDate(clamped);
    setReviewRange([]);
  }, [weekStart, selectedDate]);

  const updateConfig = (patch: Partial<CalendarAiConfig>) => {
    const next = { ...config, ...patch };
    setConfig(next);
    saveCalendarAiConfig(ownerType, ownerId, next);
  };

  const applyPreset = (presetId: CalendarAiConfig["preset"]) => {
    const preset = CALENDAR_GENERATION_PRESETS.find(item => item.id === presetId);
    updateConfig({
      preset: presetId,
      ...(preset ? { ratios: { ...config.ratios, ...preset.ratios } } : {}),
    });
  };

  const setRatio = (tagId: string, value: number) => {
    updateConfig({ ratios: { ...config.ratios, [tagId]: Math.max(0, Math.min(100, value)) } });
  };

  const createArc = () => {
    const now = new Date();
    const title = (arcTitleDraft.trim() || config.arcClue.trim().slice(0, 24) || "一个正在酝酿的事件").slice(0, 40);
    const expected = new Date(now.getTime() + Math.max(1, config.arcCycleDays) * 86_400_000);
    const saved = saveCalendarArc({
      id: `calendar_arc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      ownerType,
      ownerId,
      title,
      nature: config.arcNature,
      clue: config.arcClue,
      stage: "刚刚开始",
      status: "active",
      startedAt: now.toISOString(),
      expectedEndAt: expected.toISOString(),
      lastAdvancedAt: now.toISOString(),
      history: [{ date: now.toISOString().slice(0, 10), note: "大事件开始" }],
    });
    setArcs(loadActiveCalendarArcs(ownerType, ownerId));
    setArcTitleDraft("");
    onNotice?.(`大事件「${saved.title}」已开始`);
  };

  const updateArcStage = (arc: CalendarStoryArc, stage: string) => {
    saveCalendarArc({
      ...arc,
      stage,
      lastAdvancedAt: new Date().toISOString(),
      history: [...arc.history, { date: new Date().toISOString().slice(0, 10), note: stage }].slice(-20),
    });
    setArcs(loadActiveCalendarArcs(ownerType, ownerId));
  };

  const finishArc = (arc: CalendarStoryArc) => {
    endCalendarArc(arc.id);
    setArcs(loadActiveCalendarArcs(ownerType, ownerId));
    onNotice?.(`大事件「${arc.title}」已结束`);
  };

  const generateWeek = async () => {
    if (!isCharacter || weeklyBusy) return;
    setWeeklyBusy(true);
    try {
      if (scheduleEndDate < scheduleStartDate) {
        onNotice?.("结束日期不能早于开始日期");
        return;
      }
      const result = await previewCalendarScheduleRange(ownerType, ownerId, scheduleStartDate, scheduleEndDate);
      if (!result.success || !result.items) {
        onNotice?.(result.error || "生成失败");
        return;
      }
      setWeeklyPreview(result.items);
      setSelectedWeekIds(new Set(result.items.map(item => item.id)));
    } finally {
      setWeeklyBusy(false);
    }
  };

  const updateWeeklyItem = (id: string, patch: Partial<CalendarScheduleItem>) => {
    setWeeklyPreview(prev => prev?.map(item => item.id === id ? { ...item, ...patch } : item) ?? null);
  };

  const acceptWeek = () => {
    if (!weeklyPreview) return;
    const selected = weeklyPreview
      .filter(item => selectedWeekIds.has(item.id))
      .map(item => ({ ...item, title: item.title.trim() }))
      .filter(item => item.title && item.startTime < item.endTime);
    if (selected.length === 0) {
      onNotice?.("至少选择一条时间有效、标题不为空的日程");
      return;
    }
    onApplyWeekly(selected, scheduleStartDate, scheduleEndDate);
    setWeeklyPreview(null);
  };

  const generateDay = async () => {
    if (!isCharacter || dayBusy) return;
    setDayBusy(true);
    try {
      const result = await previewCalendarDayReview({
        ownerType,
        ownerId,
        date: selectedDate,
        includeChat,
        extraHint,
      });
      if (!result.success) {
        onNotice?.(result.error);
        return;
      }
      setReviewPreview(result.review);
      setReviewKeywordsText(result.review.keywords.join(" / "));
    } finally {
      setDayBusy(false);
    }
  };

  const todayIso = formatIsoDate(new Date());

  const generateReviewRange = async () => {
    if (rangeBusy || dayBusy) return;
    const end = reviewEndDate > todayIso ? todayIso : reviewEndDate;
    const start = reviewStartDate > end ? end : reviewStartDate;
    const dates: string[] = [];
    for (let cursor = parseIsoDate(start).getTime(); cursor <= parseIsoDate(end).getTime(); cursor += 86_400_000) {
      dates.push(formatIsoDate(new Date(cursor)));
    }
    if (dates.length === 0) return;
    if (dates.length > 14) {
      onNotice?.("一次最多回顾 14 天，避免过多 API 调用");
      return;
    }
    setReviewStartDate(start);
    setReviewEndDate(end);
    setRangeBusy(true);
    try {
      const results: Array<{ date: string; review: CalendarDayReviewDraft }> = [];
      for (const date of dates) {
        const result = await previewCalendarDayReview({
          ownerType,
          ownerId,
          date,
          includeChat,
          extraHint,
        });
        if (result.success) results.push({ date, review: result.review });
      }
      if (results.length === 0) {
        onNotice?.("这段日期没有生成出可保存的回顾");
        return;
      }
      setReviewRange(results);
    } finally {
      setRangeBusy(false);
    }
  };

  const acceptReviewRange = () => {
    for (const item of reviewRange) onApplyDayReviewForDate(item.date, item.review);
    onNotice?.(`已保存 ${reviewRange.length} 天的回顾`);
    setReviewRange([]);
  };

  const updateReviewExperience = (index: number, patch: Partial<CalendarExperience>) => {
    setReviewPreview(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        experiences: prev.experiences.map((item, idx) => idx === index ? { ...item, ...patch } : item),
      };
    });
  };

  const removeReviewExperience = (index: number) => {
    setReviewPreview(prev => prev
      ? { ...prev, experiences: prev.experiences.filter((_, idx) => idx !== index) }
      : prev);
  };

  const acceptDay = () => {
    if (!reviewPreview) return;
    onApplyDayReview(reviewPreview);
    setReviewPreview(null);
    setReviewKeywordsText("");
  };

  const selectedEventTags = useMemo(() => {
    return CALENDAR_GENERATION_PRESETS;
  }, []);

  return (
    <div className="calendar-page calendar-page-generate">
      <div className="calendar-apple-topbar">
        <button type="button" className="calendar-pill-btn calendar-back-btn" onClick={onBack}>
          <ChevronLeft size={18} />
          {date.getMonth() + 1}月
        </button>
        <span className="calendar-topbar-space" />
        <span className="calendar-generate-owner">{ownerName}</span>
      </div>

      {ownerStrip}
      <CalendarViewTabs active={activeTab} onChange={onTabChange} />

      <div className="calendar-generate-scroll hide-scrollbar">
        <header className="calendar-generate-hero">
          <span className="calendar-generate-eyebrow">SETTINGS / TASKS</span>
          <h2>设置与生成</h2>
          <p>所有 AI 操作都需要你主动触发，先生成预览，再决定保存什么。</p>
        </header>

        <section className="calendar-generate-card">
          <div className="calendar-generate-card-head">
            <span className="calendar-generate-card-icon"><SlidersHorizontal size={17} /></span>
            <div>
              <strong>行程生成设置</strong>
              <em>{getCalendarRatioLabel(config.ratios)}</em>
            </div>
          </div>
          <div className="calendar-generate-date-row">
            <label>
              <span>开始</span>
              <input
                type="date"
                value={scheduleStartDate}
                onChange={event => {
                  setScheduleStartDate(event.target.value);
                  if (event.target.value > scheduleEndDate) setScheduleEndDate(event.target.value);
                }}
              />
            </label>
            <label>
              <span>结束</span>
              <input
                type="date"
                value={scheduleEndDate}
                min={scheduleStartDate}
                onChange={event => setScheduleEndDate(event.target.value)}
              />
            </label>
          </div>
          <div className="calendar-generate-date-quick hide-scrollbar">
            <button type="button" onClick={() => {
              setScheduleStartDate(selectedDate);
              setScheduleEndDate(selectedDate);
            }}>今天</button>
            <button type="button" onClick={() => {
              setScheduleStartDate(weekStart);
              setScheduleEndDate(formatIsoDate(new Date(parseIsoDate(weekStart).getTime() + 6 * 86_400_000)));
            }}>本周</button>
            <button type="button" onClick={() => {
              setScheduleStartDate(selectedDate);
              setScheduleEndDate(formatIsoDate(new Date(parseIsoDate(selectedDate).getTime() + 2 * 86_400_000)));
            }}>3 天</button>
            <em>{scheduleStartDate} 至 {scheduleEndDate}</em>
          </div>

          <div className="calendar-generate-presets hide-scrollbar">
            {selectedEventTags.map(preset => (
              <button
                key={preset.id}
                type="button"
                className="calendar-generate-preset"
                data-active={config.preset === preset.id ? "true" : undefined}
                onClick={() => applyPreset(preset.id)}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <div className="calendar-generate-ratios">
            {Object.entries(config.ratios).map(([tagId, value]) => (
              <label key={tagId} className="calendar-generate-ratio">
                <span>{tagLabel(tagId)}</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={value}
                  onChange={event => setRatio(tagId, Number(event.target.value))}
                />
                <em>{value}%</em>
              </label>
            ))}
          </div>
          <div className="calendar-generate-field">
            <span>大事件连续性</span>
            <Toggle checked={config.arcEnabled} onChange={checked => updateConfig({ arcEnabled: checked })} />
          </div>
          {config.arcEnabled ? (
            <div className="calendar-generate-arc">
              <label>
                倾向 / 概率
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={config.arcChance}
                  onChange={event => updateConfig({ arcChance: Number(event.target.value) })}
                />
                <em>{config.arcChance}%</em>
              </label>
              <label>
                发展周期（天）
                <input
                  type="number"
                  min={1}
                  max={90}
                  value={config.arcCycleDays}
                  onChange={event => updateConfig({ arcCycleDays: Number(event.target.value) })}
                />
              </label>
              <label>
                事件性质
                <input
                  value={config.arcNature}
                  onChange={event => updateConfig({ arcNature: event.target.value })}
                  placeholder="工作合作 / 感情发展 / 家庭 / 个人目标"
                />
              </label>
              <label>
                自定义线索
                <textarea
                  value={config.arcClue}
                  onChange={event => updateConfig({ arcClue: event.target.value })}
                  placeholder="例如：一项商业合作从接触到签约，中间出现变数。"
                  rows={3}
                />
              </label>
            </div>
          ) : null}
          {config.arcEnabled ? (
            <div className="calendar-generate-arc-active">
              {arcs.map(arc => (
                <div key={arc.id} className="calendar-generate-arc-item">
                  <div>
                    <strong>{arc.title}</strong>
                    <input
                      defaultValue={arc.stage}
                      onBlur={event => {
                        const value = event.target.value.trim();
                        if (value && value !== arc.stage) updateArcStage(arc, value);
                      }}
                      aria-label="大事件当前阶段"
                    />
                  </div>
                  <button type="button" onClick={() => finishArc(arc)}>结束</button>
                </div>
              ))}
              <div className="calendar-generate-arc-create">
                <input
                  value={arcTitleDraft}
                  onChange={event => setArcTitleDraft(event.target.value)}
                  placeholder="大事件标题（留空则用线索开头）"
                />
                <button type="button" onClick={createArc}>开始一个大事件</button>
              </div>
            </div>
          ) : null}

          <div className="calendar-generate-field">
            <span>自定义提示词</span>
          </div>
          <textarea
            className="calendar-generate-textarea"
            value={config.customPrompt}
            onChange={event => updateConfig({ customPrompt: event.target.value })}
            placeholder="例如：这周让 TA 多去几次公司附近的咖啡店；不要安排通宵。"
            rows={3}
          />
          <div className="calendar-generate-card-actions">
            <span className="calendar-generate-cost">1 次 API 调用 · 先生成预览</span>
            <button
              type="button"
              className="calendar-block-btn"
              data-variant="primary"
              data-loading={weeklyBusy ? "true" : undefined}
              disabled={!isCharacter || weeklyBusy}
              onClick={generateWeek}
            >
              {weeklyBusy ? "生成中…" : isCharacter ? "生成日程" : "仅角色支持"}
            </button>
          </div>
        </section>

        <CalendarProactiveSettings
          ownerType={ownerType}
          ownerId={ownerId}
          weekStart={weekStart}
          onNotice={onNotice}
        />

        <CalendarHolidaySettings onNotice={onNotice} />

        <section className="calendar-generate-card">
          <div className="calendar-generate-card-head">
            <span className="calendar-generate-card-icon"><History size={17} /></span>
            <div>
              <strong>回顾与批量回顾</strong>
              <em>补全已结束行程的实际经历，生成额外经历、双标签、心情和小结。</em>
            </div>
          </div>
          <div className="calendar-generate-date-row">
            <label>
              <span>开始</span>
              <input
                type="date"
                value={reviewStartDate}
                max={todayIso}
                onChange={event => {
                  const value = event.target.value > todayIso ? todayIso : event.target.value;
                  setReviewStartDate(value);
                  if (value > reviewEndDate) setReviewEndDate(value);
                }}
              />
            </label>
            <label>
              <span>结束（最多今天）</span>
              <input
                type="date"
                value={reviewEndDate}
                min={reviewStartDate}
                max={todayIso}
                onChange={event => setReviewEndDate(event.target.value > todayIso ? todayIso : event.target.value)}
              />
            </label>
          </div>
          <div className="calendar-generate-date-quick hide-scrollbar">
            <button type="button" onClick={() => { setReviewStartDate(selectedDate); setReviewEndDate(selectedDate); }}>当天</button>
            <button type="button" onClick={() => {
              setReviewStartDate(weekStart);
              setReviewEndDate(todayIso < weekStart ? weekStart : todayIso);
            }}>本周至今</button>
            <em>{reviewStartDate} 至 {reviewEndDate}</em>
          </div>
          <label className="calendar-generate-check">
            <input type="checkbox" checked={includeChat} onChange={event => setIncludeChat(event.target.checked)} />
            <span>参考当天私聊记录（只取该角色私聊，按日期截断）</span>
          </label>
          <textarea
            className="calendar-generate-textarea"
            value={extraHint}
            onChange={event => setExtraHint(event.target.value)}
            placeholder="额外要求：例如多写一点工作压力，额外经历控制在 2 条内。"
            rows={2}
          />
          <div className="calendar-generate-card-actions">
            <button type="button" className="calendar-block-btn" onClick={onOpenReview}>手动记录</button>
            <button
              type="button"
              className="calendar-block-btn"
              data-loading={dayBusy ? "true" : undefined}
              disabled={!isCharacter || dayBusy || rangeBusy}
              onClick={generateDay}
            >
              {dayBusy ? "生成中…" : isCharacter ? "回顾当天" : "仅角色支持"}
            </button>
            <button
              type="button"
              className="calendar-block-btn"
              data-variant="primary"
              data-loading={rangeBusy ? "true" : undefined}
              disabled={!isCharacter || rangeBusy || dayBusy}
              onClick={generateReviewRange}
            >
              {rangeBusy ? "生成中…" : "批量回顾"}
            </button>
          </div>
          <p className="calendar-generate-cost" style={{ marginTop: 6 }}>
            批量回顾按天调用：{reviewStartDate} 至 {reviewEndDate}，最多 14 天。
          </p>
        </section>

        <section className="calendar-generate-card" data-muted="true">
          <div className="calendar-generate-card-head">
            <span className="calendar-generate-card-icon"><Sparkles size={17} /></span>
            <div>
              <strong>本周数据复盘</strong>
              <em>统计先由本地计算；只有你点“生成本周回顾”时才调用 API。</em>
            </div>
          </div>
          <div className="calendar-generate-card-actions">
            <span className="calendar-generate-cost">本地统计 · 可选 AI 总结</span>
            <button type="button" className="calendar-block-btn" onClick={onOpenReview}>先看回顾</button>
          </div>
        </section>

        <p className="calendar-generate-footnote">
          已有行程不会被未经确认的生成结果覆盖；自动生成开关仍可在行程页菜单里控制。
        </p>
      </div>

      {weeklyPreview ? (
        <div className="modal-overlay calendar-edit-modal-overlay" onClick={() => setWeeklyPreview(null)}>
          <div className="calendar-edit-modal calendar-preview-modal" onClick={event => event.stopPropagation()}>
            <div className="modal-header">
              <button type="button" className="modal-header-btn modal-header-btn-muted" onClick={() => setWeeklyPreview(null)} aria-label="关闭">
                <X size={18} />
              </button>
              <span className="modal-header-title">行程预览</span>
              <button type="button" className="modal-header-btn modal-header-btn-action" onClick={acceptWeek} aria-label="接受">
                <Check size={18} />
              </button>
            </div>
            <div className="modal-body hide-scrollbar calendar-preview-body">
              <p className="calendar-preview-hint">勾选要保存的日程；可以直接改标题、时间和地点。手动条目不会被覆盖。</p>
              {weeklyPreview.map(item => (
                <div key={item.id} className="calendar-preview-item" data-selected={selectedWeekIds.has(item.id) ? "true" : undefined}>
                  <input
                    type="checkbox"
                    checked={selectedWeekIds.has(item.id)}
                    onChange={event => {
                      setSelectedWeekIds(prev => {
                        const next = new Set(prev);
                        if (event.target.checked) next.add(item.id);
                        else next.delete(item.id);
                        return next;
                      });
                    }}
                  />
                  <div className="calendar-preview-item-fields">
                    <div className="calendar-preview-item-line">
                      <span>{item.date} · {weekdayLabel(item.date)}</span>
                      <input value={item.title} onChange={event => updateWeeklyItem(item.id, { title: event.target.value })} />
                    </div>
                    <div className="calendar-preview-item-line">
                      <input type="time" value={item.startTime} onChange={event => updateWeeklyItem(item.id, { startTime: event.target.value })} />
                      <span>–</span>
                      <input type="time" value={item.endTime} onChange={event => updateWeeklyItem(item.id, { endTime: event.target.value })} />
                      <input value={item.location} placeholder="地点" onChange={event => updateWeeklyItem(item.id, { location: event.target.value })} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="calendar-preview-footer">
              <button type="button" className="calendar-block-btn" data-variant="ghost" onClick={generateWeek} disabled={weeklyBusy}>
                <RotateCw size={15} /> 重新生成
              </button>
              <button type="button" className="calendar-block-btn" data-variant="primary" onClick={acceptWeek}>
                接受选中
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {reviewPreview ? (
        <div className="modal-overlay calendar-edit-modal-overlay" onClick={() => setReviewPreview(null)}>
          <div className="calendar-edit-modal calendar-preview-modal" onClick={event => event.stopPropagation()}>
            <div className="modal-header">
              <button type="button" className="modal-header-btn modal-header-btn-muted" onClick={() => setReviewPreview(null)} aria-label="关闭">
                <X size={18} />
              </button>
              <span className="modal-header-title">今日回顾预览</span>
              <button type="button" className="modal-header-btn modal-header-btn-action" onClick={acceptDay} aria-label="保存">
                <Check size={18} />
              </button>
            </div>
            <div className="modal-body hide-scrollbar calendar-preview-body">
              <div className="calendar-preview-mood">
                <span>今日心情</span>
                <div>
                  {CALENDAR_DAILY_MOODS.map(item => (
                    <button
                      key={item.value}
                      type="button"
                      data-active={reviewPreview.mood === item.value ? "true" : undefined}
                      onClick={() => setReviewPreview({ ...reviewPreview, mood: item.value })}
                    >
                      {item.emoji}
                    </button>
                  ))}
                </div>
                <b>{getCalendarDailyMoodMeta(reviewPreview.mood)?.label ?? "未设置"}</b>
              </div>
              <label className="calendar-preview-field">
                今日关键词
                <input
                  value={reviewKeywordsText}
                  onChange={event => {
                    setReviewKeywordsText(event.target.value);
                    setReviewPreview({
                      ...reviewPreview,
                      keywords: event.target.value.split(/[,，、/|]+/).map(item => item.trim()).filter(Boolean).slice(0, 6),
                    });
                  }}
                />
              </label>
              <label className="calendar-preview-field">
                今日小结
                <textarea
                  value={reviewPreview.summary}
                  rows={3}
                  onChange={event => setReviewPreview({ ...reviewPreview, summary: event.target.value })}
                />
              </label>
              <div className="calendar-preview-experiences">
                <span>经历（{reviewPreview.experiences.length} 条）</span>
                {reviewPreview.experiences.map((experience, index) => (
                  <div key={experience.id} className="calendar-preview-experience">
                    <div className="calendar-preview-experience-head">
                      <input
                        value={experience.title}
                        onChange={event => updateReviewExperience(index, { title: event.target.value })}
                      />
                      <button type="button" onClick={() => removeReviewExperience(index)} aria-label="移除">
                        <X size={14} />
                      </button>
                    </div>
                    <div className="calendar-preview-experience-meta">
                      <span>{experience.kind === "schedule" ? "既定行程" : "额外经历"}</span>
                      <span>{experience.startTime}</span>
                      <span>#{tagName(experience.eventTypeId)}</span>
                      <span>#{tagMoodName(experience.moodTypeId)}</span>
                    </div>
                    <textarea
                      value={experience.note}
                      rows={2}
                      onChange={event => updateReviewExperience(index, { note: event.target.value })}
                    />
                  </div>
                ))}
              </div>
            </div>
            <div className="calendar-preview-footer">
              <button type="button" className="calendar-block-btn" data-variant="ghost" onClick={generateDay} disabled={dayBusy}>
                <RotateCw size={15} /> 重新生成
              </button>
              <button type="button" className="calendar-block-btn" data-variant="primary" onClick={acceptDay}>
                保存回顾
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {reviewRange.length > 0 ? (
        <div className="modal-overlay calendar-edit-modal-overlay" onClick={() => setReviewRange([])}>
          <div className="calendar-edit-modal calendar-preview-modal" onClick={event => event.stopPropagation()}>
            <div className="modal-header">
              <button type="button" className="modal-header-btn modal-header-btn-muted" onClick={() => setReviewRange([])} aria-label="关闭">
                <X size={18} />
              </button>
              <span className="modal-header-title">批量回顾预览</span>
              <button type="button" className="modal-header-btn modal-header-btn-action" onClick={acceptReviewRange} aria-label="保存">
                <Check size={18} />
              </button>
            </div>
            <div className="modal-body hide-scrollbar calendar-preview-body">
              <p className="calendar-preview-hint">
                共 {reviewRange.length} 天。每天已生成一条独立回顾；保存后会分别写入对应日期。可先移除不想保存的日期。
              </p>
              {reviewRange.map((item, index) => (
                <section key={item.date} className="calendar-range-day">
                  <header>
                    <div>
                      <span>{item.date}</span>
                      <strong>{weekdayLabel(item.date)}</strong>
                    </div>
                    <button type="button" onClick={() => setReviewRange(prev => prev.filter((_, idx) => idx !== index))} aria-label="移除这一天">
                      <X size={14} />
                    </button>
                  </header>
                  <div className="calendar-range-day-meta">
                    <span>{getCalendarDailyMoodMeta(item.review.mood)?.emoji ?? "—"} {getCalendarDailyMoodMeta(item.review.mood)?.label ?? "未设置心情"}</span>
                    <span>{item.review.experiences.length} 条经历</span>
                  </div>
                  {item.review.keywords.length > 0 ? <em>{item.review.keywords.join(" / ")}</em> : null}
                  {item.review.summary ? <p>{item.review.summary}</p> : null}
                </section>
              ))}
            </div>
            <div className="calendar-preview-footer">
              <button type="button" className="calendar-block-btn" data-variant="ghost" onClick={() => setReviewRange([])}>
                取消
              </button>
              <button type="button" className="calendar-block-btn" data-variant="primary" onClick={acceptReviewRange}>
                保存 {reviewRange.length} 天
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function weekdayLabel(iso: string): string {
  return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][parseIsoDate(iso).getDay()];
}

function tagLabel(tagId: string): string {
  const map: Record<string, string> = {
    work: "工作", daily: "日常", social_obligation: "应酬", social: "社交", date: "约会",
    leisure: "休闲", entertainment: "娱乐", study: "学习", travel: "出行", special: "特殊事件",
  };
  return map[tagId] ?? tagId;
}

function tagName(tagId: string): string {
  return tagLabel(tagId);
}

function tagMoodName(tagId: string): string {
  const map: Record<string, string> = {
    calm: "平静", happy: "开心", sweet: "甜蜜", excited: "兴奋", moved: "感动",
    annoyed: "烦闷", tired: "疲惫", down: "低落", anxious: "焦虑", angry: "愤怒",
  };
  return map[tagId] ?? tagId;
}
