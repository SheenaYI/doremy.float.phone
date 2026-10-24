import { kvGet, kvSet, registerKvMigration } from "./kv-db";
import type { CalendarOwnerType } from "./calendar-types";
import { normalizeTime, parseIsoDate, timeToMinutes } from "./calendar-utils";

export type CalendarProactiveTrigger =
  | "start"
  | "after_start"
  | "before_end"
  | "end"
  | "after_end"
  | "custom";

export type CalendarProactiveConfig = {
  id: string;
  ownerType: CalendarOwnerType;
  ownerId: string;
  itemId: string;
  date: string;
  title: string;
  trigger: CalendarProactiveTrigger;
  /** start/end 之外的自定义偏移分钟；custom 时表示相对开始的分钟数 */
  offsetMinutes: number;
  probability: number;
  allowSkip: boolean;
  extraPrompt: string;
  fireAt: number;
  shouldFire: boolean;
  firedAt?: number;
  createdAt: string;
  updatedAt: string;
};

type PersistedStore = { configs: CalendarProactiveConfig[] };

const KEY = "ai_phone_calendar_proactive_v1";
registerKvMigration(KEY);

const TRIGGERS = new Set<CalendarProactiveTrigger>(["start", "after_start", "before_end", "end", "after_end", "custom"]);

export const CALENDAR_PROACTIVE_TRIGGER_OPTIONS: Array<{
  id: CalendarProactiveTrigger;
  label: string;
  needsOffset: boolean;
  defaultOffset: number;
}> = [
  { id: "start", label: "开始时", needsOffset: false, defaultOffset: 0 },
  { id: "after_start", label: "开始后指定分钟", needsOffset: true, defaultOffset: 30 },
  { id: "before_end", label: "结束前指定分钟", needsOffset: true, defaultOffset: 10 },
  { id: "end", label: "结束时", needsOffset: false, defaultOffset: 0 },
  { id: "after_end", label: "结束后指定分钟", needsOffset: true, defaultOffset: 10 },
  { id: "custom", label: "自定义时间", needsOffset: true, defaultOffset: 0 },
];

function cleanText(value: unknown, maxLength: number): string {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, maxLength);
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function normalizeTrigger(value: unknown): CalendarProactiveTrigger {
  return TRIGGERS.has(value as CalendarProactiveTrigger) ? value as CalendarProactiveTrigger : "start";
}

function normalizeConfig(raw: unknown): CalendarProactiveConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const id = cleanText(record.id, 140);
  const ownerId = cleanText(record.ownerId, 160);
  const itemId = cleanText(record.itemId, 160);
  const date = cleanText(record.date, 10);
  if (!id || !ownerId || !itemId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const now = new Date().toISOString();
  return {
    id,
    ownerType: record.ownerType === "user" ? "user" : "character",
    ownerId,
    itemId,
    date,
    title: cleanText(record.title, 80),
    trigger: normalizeTrigger(record.trigger),
    offsetMinutes: clamp(record.offsetMinutes, 0, 24 * 60, 0),
    probability: clamp(record.probability, 0, 100, 70),
    allowSkip: record.allowSkip !== false,
    extraPrompt: cleanText(record.extraPrompt, 600),
    fireAt: typeof record.fireAt === "number" && Number.isFinite(record.fireAt) ? record.fireAt : 0,
    shouldFire: record.shouldFire === true,
    firedAt: typeof record.firedAt === "number" ? record.firedAt : undefined,
    createdAt: typeof record.createdAt === "string" ? record.createdAt : now,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : now,
  };
}

function loadStore(): PersistedStore {
  if (typeof window === "undefined") return { configs: [] };
  try {
    const raw = kvGet(KEY);
    if (!raw) return { configs: [] };
    const parsed = JSON.parse(raw) as Partial<PersistedStore>;
    return {
      configs: Array.isArray(parsed.configs)
        ? parsed.configs.map(normalizeConfig).filter((item): item is CalendarProactiveConfig => Boolean(item))
        : [],
    };
  } catch {
    return { configs: [] };
  }
}

function saveStore(store: PersistedStore): void {
  if (typeof window === "undefined") return;
  kvSet(KEY, JSON.stringify({ configs: store.configs.slice(0, 2000) }));
}

export function loadCalendarProactiveConfigs(): CalendarProactiveConfig[] {
  return loadStore().configs;
}

export function loadCalendarProactiveConfigForItem(
  ownerType: CalendarOwnerType,
  ownerId: string,
  itemId: string,
): CalendarProactiveConfig | null {
  return loadStore().configs.find(config =>
    config.ownerType === ownerType && config.ownerId === ownerId && config.itemId === itemId
  ) ?? null;
}

export function computeCalendarProactiveFireAt(params: {
  date: string;
  startTime: string;
  endTime: string;
  trigger: CalendarProactiveTrigger;
  offsetMinutes: number;
}): number {
  const start = timeToMinutes(params.startTime);
  const end = timeToMinutes(params.endTime);
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  const base = parseIsoDate(params.date).getTime();
  let minutes = start;
  switch (params.trigger) {
    case "after_start":
      minutes = start + params.offsetMinutes;
      break;
    case "before_end":
      minutes = end - params.offsetMinutes;
      break;
    case "end":
      minutes = end;
      break;
    case "after_end":
      minutes = end + params.offsetMinutes;
      break;
    case "custom":
      minutes = start + params.offsetMinutes;
      break;
    default:
      minutes = start;
  }
  return base + Math.max(0, minutes) * 60_000;
}

export function saveCalendarProactiveConfig(params: {
  ownerType: CalendarOwnerType;
  ownerId: string;
  itemId: string;
  date: string;
  title: string;
  startTime: string;
  endTime: string;
  trigger: CalendarProactiveTrigger;
  offsetMinutes: number;
  probability: number;
  allowSkip: boolean;
  extraPrompt: string;
  reroll?: boolean;
}): CalendarProactiveConfig {
  const existing = loadCalendarProactiveConfigForItem(params.ownerType, params.ownerId, params.itemId);
  const fireAt = computeCalendarProactiveFireAt(params);
  const probability = clamp(params.probability, 0, 100, 70);
  const shouldFire = params.reroll || !existing
    ? Math.random() * 100 < probability
    : existing.shouldFire;
  const now = new Date().toISOString();
  const config: CalendarProactiveConfig = {
    id: existing?.id ?? `calendar_proactive_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    ownerType: params.ownerType,
    ownerId: params.ownerId,
    itemId: params.itemId,
    date: params.date,
    title: params.title,
    trigger: params.trigger,
    offsetMinutes: params.offsetMinutes,
    probability,
    allowSkip: params.allowSkip,
    extraPrompt: params.extraPrompt,
    fireAt,
    shouldFire,
    firedAt: params.reroll || existing?.fireAt !== fireAt ? undefined : existing?.firedAt,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  const store = loadStore();
  saveStore({ configs: [...store.configs.filter(item => item.id !== config.id), config] });
  return config;
}

export function deleteCalendarProactiveConfigForItem(
  ownerType: CalendarOwnerType,
  ownerId: string,
  itemId: string,
): void {
  const store = loadStore();
  saveStore({
    configs: store.configs.filter(config =>
      !(config.ownerType === ownerType && config.ownerId === ownerId && config.itemId === itemId)
    ),
  });
}

export function markCalendarProactiveFired(configId: string, firedAt = Date.now()): void {
  const store = loadStore();
  saveStore({
    configs: store.configs.map(config => config.id === configId
      ? { ...config, firedAt, updatedAt: new Date().toISOString() }
      : config),
  });
}

/** 到点、未触发、且没有超过补触发窗口的配置。 */
export function loadDueCalendarProactiveConfigs(now = Date.now(), graceMs = 15 * 60_000): CalendarProactiveConfig[] {
  return loadStore().configs.filter(config =>
    config.shouldFire
    && !config.firedAt
    && config.fireAt > 0
    && now >= config.fireAt
    && now - config.fireAt <= graceMs
  );
}
