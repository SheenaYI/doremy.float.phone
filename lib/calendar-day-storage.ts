import { kvGet, kvSet, registerKvMigration } from "./kv-db";
import { normalizeTime } from "./calendar-utils";
import type { CalendarOwnerType } from "./calendar-types";
import {
  DEFAULT_CALENDAR_TAG_CONFIG,
  DEFAULT_EVENT_TYPE_TAGS,
  DEFAULT_MOOD_TYPE_TAGS,
  type CalendarDailyMood,
  type CalendarDayRecord,
  type CalendarExperience,
  type CalendarExperienceImage,
  type CalendarTag,
  type CalendarTagConfig,
  type CalendarTagKind,
} from "./calendar-day-types";

const DAY_RECORDS_KEY = "ai_phone_calendar_day_records_v1";
const TAG_CONFIG_KEY = "ai_phone_calendar_tag_config_v1";
registerKvMigration(DAY_RECORDS_KEY);
registerKvMigration(TAG_CONFIG_KEY);

type PersistedDayStore = {
  records: CalendarDayRecord[];
};

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MOOD_VALUES = new Set([1, 2, 3, 4, 5]);

function makeId(prefix: string): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return `${prefix}_${crypto.randomUUID()}`;
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function cleanText(value: unknown, maxLength: number): string {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, maxLength);
}

function cleanMultiline(value: unknown, maxLength: number): string {
  return cleanText(value, maxLength).replace(/\r\n?/g, "\n").replace(/\\n/g, "\n");
}

function cleanKeywords(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,，、/|]+/)
      : [];
  return Array.from(new Set(raw.map(item => cleanText(item, 16)).filter(Boolean))).slice(0, 6);
}

function normalizeMood(value: unknown): CalendarDailyMood | null {
  const number = typeof value === "number" ? Math.round(value) : NaN;
  return MOOD_VALUES.has(number) ? number as CalendarDailyMood : null;
}

function normalizeOwnerType(value: unknown): CalendarOwnerType {
  return value === "character" ? "character" : "user";
}

function normalizeImages(value: unknown): CalendarExperienceImage[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((raw): CalendarExperienceImage | null => {
      if (!raw || typeof raw !== "object") return null;
      const record = raw as Record<string, unknown>;
      const mediaRef = cleanText(record.mediaRef, 512);
      if (!mediaRef) return null;
      return {
        id: cleanText(record.id, 120) || makeId("calendar_image"),
        mediaRef,
        source: record.source === "generated" ? "generated" : "upload",
        caption: cleanText(record.caption, 80) || undefined,
        createdAt: typeof record.createdAt === "string" ? record.createdAt : new Date().toISOString(),
      };
    })
    .filter((item): item is CalendarExperienceImage => Boolean(item))
    .slice(0, 4);
}

function normalizeExperience(raw: unknown, date: string): CalendarExperience | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const startTime = normalizeTime(String(record.startTime ?? ""));
  const endTimeRaw = String(record.endTime ?? "");
  const endTime = endTimeRaw ? normalizeTime(endTimeRaw) : null;
  const title = cleanText(record.title, 60);
  if (!startTime || !title) return null;
  const kind = record.kind === "schedule" ? "schedule" : "extra";
  const now = new Date().toISOString();
  return {
    id: cleanText(record.id, 120) || makeId("calendar_experience"),
    date,
    startTime,
    endTime: endTime || undefined,
    title,
    eventTypeId: cleanText(record.eventTypeId, 60) || "daily",
    moodTypeId: cleanText(record.moodTypeId, 60) || "calm",
    note: cleanMultiline(record.note, 2000),
    kind,
    linkedScheduleId: cleanText(record.linkedScheduleId, 160) || undefined,
    images: normalizeImages(record.images),
    source: record.source === "generated" ? "generated" : "manual",
    createdAt: typeof record.createdAt === "string" ? record.createdAt : now,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : now,
  };
}

function sortExperiences(experiences: CalendarExperience[]): CalendarExperience[] {
  return [...experiences].sort((a, b) => {
    if (a.startTime !== b.startTime) return a.startTime.localeCompare(b.startTime);
    return a.createdAt.localeCompare(b.createdAt);
  });
}

export function normalizeCalendarDayRecord(raw: unknown): CalendarDayRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const date = cleanText(record.date, 10);
  const ownerId = cleanText(record.ownerId, 160);
  if (!DAY_RE.test(date) || !ownerId) return null;
  const experiences = Array.isArray(record.experiences)
    ? record.experiences
        .map(item => normalizeExperience(item, date))
        .filter((item): item is CalendarExperience => Boolean(item))
        .slice(0, 80)
    : [];
  const now = new Date().toISOString();
  return {
    ownerType: normalizeOwnerType(record.ownerType),
    ownerId,
    date,
    mood: normalizeMood(record.mood),
    keywords: cleanKeywords(record.keywords),
    summary: cleanMultiline(record.summary, 1200),
    confirmedAt: typeof record.confirmedAt === "string" && record.confirmedAt ? record.confirmedAt : undefined,
    experiences: sortExperiences(experiences),
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : now,
  };
}

function loadStore(): PersistedDayStore {
  if (typeof window === "undefined") return { records: [] };
  try {
    const raw = kvGet(DAY_RECORDS_KEY);
    if (!raw) return { records: [] };
    const parsed = JSON.parse(raw) as Partial<PersistedDayStore>;
    return {
      records: Array.isArray(parsed.records)
        ? parsed.records.map(normalizeCalendarDayRecord).filter((item): item is CalendarDayRecord => Boolean(item))
        : [],
    };
  } catch {
    return { records: [] };
  }
}

function saveStore(store: PersistedDayStore): void {
  if (typeof window === "undefined") return;
  kvSet(DAY_RECORDS_KEY, JSON.stringify({ records: store.records.slice(0, 2000) }));
}

export function loadCalendarDayRecords(ownerType: CalendarOwnerType, ownerId: string): CalendarDayRecord[] {
  return loadStore().records
    .filter(record => record.ownerType === ownerType && record.ownerId === ownerId)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function loadCalendarDayRecord(
  ownerType: CalendarOwnerType,
  ownerId: string,
  date: string,
): CalendarDayRecord | null {
  return loadStore().records.find(
    record => record.ownerType === ownerType && record.ownerId === ownerId && record.date === date,
  ) ?? null;
}

export function loadCalendarDayRecordMap(
  ownerType: CalendarOwnerType,
  ownerId: string,
): Map<string, CalendarDayRecord> {
  const map = new Map<string, CalendarDayRecord>();
  for (const record of loadCalendarDayRecords(ownerType, ownerId)) map.set(record.date, record);
  return map;
}

export function loadCalendarDayRecordsInRange(
  ownerType: CalendarOwnerType,
  ownerId: string,
  startDate: string,
  endDate: string,
): CalendarDayRecord[] {
  return loadCalendarDayRecords(ownerType, ownerId).filter(record => record.date >= startDate && record.date <= endDate);
}

export function saveCalendarDayRecord(record: CalendarDayRecord): CalendarDayRecord {
  const normalized = normalizeCalendarDayRecord({
    ...record,
    updatedAt: new Date().toISOString(),
  });
  if (!normalized) throw new Error("日历日记录无效");
  const store = loadStore();
  const next = store.records.filter(
    item => !(item.ownerType === normalized.ownerType && item.ownerId === normalized.ownerId && item.date === normalized.date),
  );
  next.push(normalized);
  saveStore({ records: next });
  return normalized;
}

export function updateCalendarDayRecord(
  ownerType: CalendarOwnerType,
  ownerId: string,
  date: string,
  patch: Partial<Omit<CalendarDayRecord, "ownerType" | "ownerId" | "date" | "experiences">>,
): CalendarDayRecord {
  const current = loadCalendarDayRecord(ownerType, ownerId, date);
  const next: CalendarDayRecord = {
    ownerType,
    ownerId,
    date,
    mood: patch.mood !== undefined ? patch.mood : current?.mood ?? null,
    keywords: patch.keywords !== undefined ? patch.keywords : current?.keywords ?? [],
    summary: patch.summary !== undefined ? patch.summary : current?.summary ?? "",
    confirmedAt: patch.confirmedAt !== undefined ? patch.confirmedAt : current?.confirmedAt,
    experiences: current?.experiences ?? [],
    updatedAt: new Date().toISOString(),
  };
  return saveCalendarDayRecord(next);
}

export function upsertCalendarExperience(
  ownerType: CalendarOwnerType,
  ownerId: string,
  experience: CalendarExperience,
): CalendarDayRecord {
  const current = loadCalendarDayRecord(ownerType, ownerId, experience.date);
  const now = new Date().toISOString();
  const normalized = normalizeExperience({ ...experience, updatedAt: now }, experience.date);
  if (!normalized) throw new Error("经历内容无效");
  const experiences = (current?.experiences ?? []).filter(item => item.id !== normalized.id);
  experiences.push(normalized);
  return saveCalendarDayRecord({
    ownerType,
    ownerId,
    date: experience.date,
    mood: current?.mood ?? null,
    keywords: current?.keywords ?? [],
    summary: current?.summary ?? "",
    confirmedAt: current?.confirmedAt,
    experiences,
    updatedAt: now,
  });
}

export function deleteCalendarExperience(
  ownerType: CalendarOwnerType,
  ownerId: string,
  date: string,
  experienceId: string,
): CalendarDayRecord | null {
  const current = loadCalendarDayRecord(ownerType, ownerId, date);
  if (!current) return null;
  return saveCalendarDayRecord({
    ...current,
    experiences: current.experiences.filter(item => item.id !== experienceId),
    updatedAt: new Date().toISOString(),
  });
}

export function updateCalendarDayMood(
  ownerType: CalendarOwnerType,
  ownerId: string,
  date: string,
  mood: CalendarDailyMood | null,
): CalendarDayRecord {
  return updateCalendarDayRecord(ownerType, ownerId, date, { mood });
}

export function saveCalendarDayReview(params: {
  ownerType: CalendarOwnerType;
  ownerId: string;
  date: string;
  mood?: CalendarDailyMood | null;
  keywords?: string[];
  summary?: string;
  experiences?: CalendarExperience[];
  confirm?: boolean;
}): CalendarDayRecord {
  const current = loadCalendarDayRecord(params.ownerType, params.ownerId, params.date);
  const now = new Date().toISOString();
  const experiences = (params.experiences ?? current?.experiences ?? [])
    .map(item => normalizeExperience(item, params.date))
    .filter((item): item is CalendarExperience => Boolean(item))
    .slice(0, 80);
  return saveCalendarDayRecord({
    ownerType: params.ownerType,
    ownerId: params.ownerId,
    date: params.date,
    mood: params.mood !== undefined ? params.mood : current?.mood ?? null,
    keywords: params.keywords !== undefined ? params.keywords : current?.keywords ?? [],
    summary: params.summary !== undefined ? params.summary : current?.summary ?? "",
    confirmedAt: params.confirm
      ? now
      : current?.confirmedAt,
    experiences,
    updatedAt: now,
  });
}

export function createCalendarExperienceDraft(params: {
  date: string;
  startTime?: string;
  endTime?: string;
  title?: string;
  kind?: "schedule" | "extra";
  linkedScheduleId?: string;
}): CalendarExperience {
  const now = new Date().toISOString();
  return {
    id: makeId("calendar_experience"),
    date: params.date,
    startTime: normalizeTime(params.startTime ?? "") || "09:00",
    endTime: normalizeTime(params.endTime ?? "") || undefined,
    title: params.title?.trim() || "",
    eventTypeId: "daily",
    moodTypeId: "calm",
    note: "",
    kind: params.kind ?? "extra",
    linkedScheduleId: params.linkedScheduleId,
    images: [],
    source: "manual",
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeTag(raw: unknown, kind: CalendarTagKind): CalendarTag | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const id = cleanText(record.id, 60);
  const label = cleanText(record.label, 16);
  if (!id || !label) return null;
  return {
    id,
    label,
    kind,
    color: cleanText(record.color, 20) || undefined,
    emoji: cleanText(record.emoji, 8) || undefined,
    builtin: record.builtin === true,
  };
}

export function loadCalendarTagConfig(): CalendarTagConfig {
  if (typeof window === "undefined") return DEFAULT_CALENDAR_TAG_CONFIG;
  try {
    const raw = kvGet(TAG_CONFIG_KEY);
    if (!raw) return DEFAULT_CALENDAR_TAG_CONFIG;
    const parsed = JSON.parse(raw) as Partial<CalendarTagConfig>;
    const eventTypes = Array.isArray(parsed.eventTypes)
      ? parsed.eventTypes.map(item => normalizeTag(item, "event")).filter((item): item is CalendarTag => Boolean(item))
      : [];
    const moods = Array.isArray(parsed.moods)
      ? parsed.moods.map(item => normalizeTag(item, "mood")).filter((item): item is CalendarTag => Boolean(item))
      : [];
    return {
      eventTypes: mergeBuiltinTags(DEFAULT_EVENT_TYPE_TAGS, eventTypes),
      moods: mergeBuiltinTags(DEFAULT_MOOD_TYPE_TAGS, moods),
    };
  } catch {
    return DEFAULT_CALENDAR_TAG_CONFIG;
  }
}

function mergeBuiltinTags(defaults: CalendarTag[], stored: CalendarTag[]): CalendarTag[] {
  const byId = new Map(stored.map(item => [item.id, item]));
  const merged = defaults.map(item => byId.get(item.id) ?? item);
  for (const item of stored) {
    if (!merged.some(existing => existing.id === item.id)) merged.push(item);
  }
  return merged;
}

export function saveCalendarTagConfig(config: CalendarTagConfig): CalendarTagConfig {
  if (typeof window === "undefined") return config;
  const next: CalendarTagConfig = {
    eventTypes: config.eventTypes.slice(0, 40),
    moods: config.moods.slice(0, 40),
  };
  kvSet(TAG_CONFIG_KEY, JSON.stringify(next));
  return next;
}

export function addCustomCalendarTag(kind: CalendarTagKind, label: string): CalendarTag | null {
  const cleanLabel = cleanText(label, 16);
  if (!cleanLabel) return null;
  const config = loadCalendarTagConfig();
  const list = kind === "event" ? config.eventTypes : config.moods;
  const existing = list.find(item => item.label === cleanLabel);
  if (existing) return existing;
  const tag: CalendarTag = {
    id: `custom_${kind}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    label: cleanLabel,
    kind,
    builtin: false,
  };
  if (kind === "event") config.eventTypes.push(tag);
  else config.moods.push(tag);
  saveCalendarTagConfig(config);
  return tag;
}

export function getCalendarTagLabel(config: CalendarTagConfig, kind: CalendarTagKind, id: string): string {
  const list = kind === "event" ? config.eventTypes : config.moods;
  return list.find(item => item.id === id)?.label ?? (kind === "event" ? "日常" : "平静");
}

export function getCalendarTagColor(config: CalendarTagConfig, kind: CalendarTagKind, id: string): string {
  const list = kind === "event" ? config.eventTypes : config.moods;
  return list.find(item => item.id === id)?.color ?? "slate";
}
