import type { CalendarOwnerType } from "./calendar-types";

/** 每日总体心情：1 最差，5 最好。 */
export type CalendarDailyMood = 1 | 2 | 3 | 4 | 5;

export type CalendarExperienceKind = "schedule" | "extra";

export type CalendarExperienceImageSource = "upload" | "generated";

export type CalendarExperienceImage = {
  id: string;
  /** media-store://...（媒体库引用，不把 base64 写进日历 JSON） */
  mediaRef: string;
  source: CalendarExperienceImageSource;
  caption?: string;
  createdAt: string;
};

export type CalendarExperience = {
  id: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  endTime?: string; // HH:MM，额外经历可为空
  title: string;
  /** 事件类型标签 id（内置或自定义） */
  eventTypeId: string;
  /** 心情类型标签 id（内置或自定义） */
  moodTypeId: string;
  note: string;
  /** schedule = 既定行程的实际经历；extra = 额外经历 */
  kind: CalendarExperienceKind;
  /** kind=schedule 时关联的 CalendarScheduleItem.id */
  linkedScheduleId?: string;
  images: CalendarExperienceImage[];
  source: "manual" | "generated";
  createdAt: string;
  updatedAt: string;
};

export type CalendarDayRecord = {
  ownerType: CalendarOwnerType;
  ownerId: string;
  date: string; // YYYY-MM-DD
  mood: CalendarDailyMood | null;
  /** 今日关键词，最多 6 个 */
  keywords: string[];
  /** 今日小结（第一人称或第三人称均可，前端只展示） */
  summary: string;
  /** 用户确认过这一天的回顾；只有确认日才会进入短期记忆投影 */
  confirmedAt?: string;
  experiences: CalendarExperience[];
  updatedAt: string;
};

export type CalendarTagKind = "event" | "mood";

export type CalendarTag = {
  id: string;
  label: string;
  kind: CalendarTagKind;
  color?: string;
  emoji?: string;
  builtin?: boolean;
};

export type CalendarTagConfig = {
  eventTypes: CalendarTag[];
  moods: CalendarTag[];
};

export const CALENDAR_DAILY_MOODS: ReadonlyArray<{
  value: CalendarDailyMood;
  emoji: string;
  label: string;
}> = [
  { value: 1, emoji: "😫", label: "很糟" },
  { value: 2, emoji: "😕", label: "低落" },
  { value: 3, emoji: "😐", label: "平静" },
  { value: 4, emoji: "🙂", label: "不错" },
  { value: 5, emoji: "🥰", label: "很好" },
];

export const DEFAULT_EVENT_TYPE_TAGS: CalendarTag[] = [
  { id: "work", label: "工作", kind: "event", color: "blue", builtin: true },
  { id: "daily", label: "日常", kind: "event", color: "slate", builtin: true },
  { id: "social_obligation", label: "应酬", kind: "event", color: "amber", builtin: true },
  { id: "social", label: "社交", kind: "event", color: "teal", builtin: true },
  { id: "date", label: "约会", kind: "event", color: "rose", builtin: true },
  { id: "leisure", label: "休闲", kind: "event", color: "green", builtin: true },
  { id: "entertainment", label: "娱乐", kind: "event", color: "violet", builtin: true },
  { id: "study", label: "学习", kind: "event", color: "lilac", builtin: true },
  { id: "travel", label: "出行", kind: "event", color: "green", builtin: true },
  { id: "special", label: "特殊事件", kind: "event", color: "rose", builtin: true },
];

export const DEFAULT_MOOD_TYPE_TAGS: CalendarTag[] = [
  { id: "calm", label: "平静", kind: "mood", color: "slate", builtin: true },
  { id: "happy", label: "开心", kind: "mood", color: "amber", builtin: true },
  { id: "sweet", label: "甜蜜", kind: "mood", color: "rose", builtin: true },
  { id: "excited", label: "兴奋", kind: "mood", color: "violet", builtin: true },
  { id: "moved", label: "感动", kind: "mood", color: "teal", builtin: true },
  { id: "annoyed", label: "烦闷", kind: "mood", color: "amber", builtin: true },
  { id: "tired", label: "疲惫", kind: "mood", color: "slate", builtin: true },
  { id: "down", label: "低落", kind: "mood", color: "blue", builtin: true },
  { id: "anxious", label: "焦虑", kind: "mood", color: "lilac", builtin: true },
  { id: "angry", label: "愤怒", kind: "mood", color: "rose", builtin: true },
];

export const DEFAULT_CALENDAR_TAG_CONFIG: CalendarTagConfig = {
  eventTypes: DEFAULT_EVENT_TYPE_TAGS,
  moods: DEFAULT_MOOD_TYPE_TAGS,
};

export function getCalendarDailyMoodMeta(value: CalendarDailyMood | null | undefined) {
  return CALENDAR_DAILY_MOODS.find(item => item.value === value) ?? null;
}
