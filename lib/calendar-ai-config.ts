import { kvGet, kvSet, registerKvMigration } from "./kv-db";
import type { CalendarOwnerType } from "./calendar-types";
import { DEFAULT_EVENT_TYPE_TAGS } from "./calendar-day-types";

export type CalendarGenerationPreset = "busy_work" | "leisure" | "random" | "custom";

export type CalendarAiConfig = {
  /** 事件类型 id -> 百分比（软约束，不要求合计 100） */
  ratios: Record<string, number>;
  preset: CalendarGenerationPreset;
  customPrompt: string;
  arcEnabled: boolean;
  /** 0-100，软倾向，不是硬概率 */
  arcChance: number;
  arcCycleDays: number;
  arcNature: string;
  arcClue: string;
};

export type CalendarStoryArc = {
  id: string;
  ownerType: CalendarOwnerType;
  ownerId: string;
  title: string;
  nature: string;
  clue: string;
  stage: string;
  status: "active" | "ended";
  startedAt: string;
  expectedEndAt: string;
  lastAdvancedAt: string;
  history: Array<{ date: string; note: string }>;
};

type PersistedConfigStore = { configs: Record<string, CalendarAiConfig> };
type PersistedArcStore = { arcs: CalendarStoryArc[] };

const CONFIG_KEY = "ai_phone_calendar_ai_config_v1";
const ARC_KEY = "ai_phone_calendar_story_arcs_v1";
registerKvMigration(CONFIG_KEY);
registerKvMigration(ARC_KEY);

const RATIO_DEFAULTS: Record<string, number> = {
  work: 40,
  daily: 20,
  social_obligation: 5,
  social: 10,
  date: 20,
  leisure: 0,
  entertainment: 0,
  study: 0,
  travel: 0,
  special: 5,
};

export const CALENDAR_GENERATION_PRESETS: Array<{
  id: CalendarGenerationPreset;
  label: string;
  desc: string;
  ratios: Record<string, number>;
}> = [
  {
    id: "busy_work",
    label: "忙碌工作周",
    desc: "工作占比更高，社交和约会压缩到晚上",
    ratios: { work: 55, daily: 15, social_obligation: 10, social: 5, date: 5, leisure: 0, entertainment: 0, study: 5, travel: 0, special: 5 },
  },
  {
    id: "leisure",
    label: "悠闲假期",
    desc: "休闲、出行和约会更多，工作很少",
    ratios: { work: 5, daily: 20, social_obligation: 0, social: 15, date: 20, leisure: 25, entertainment: 10, study: 0, travel: 5, special: 0 },
  },
  {
    id: "random",
    label: "随机生活",
    desc: "以日常为主，各类事件自然混在一起",
    ratios: RATIO_DEFAULTS,
  },
  {
    id: "custom",
    label: "自定义",
    desc: "使用下面的比例和补充要求",
    ratios: RATIO_DEFAULTS,
  },
];

export const DEFAULT_CALENDAR_AI_CONFIG: CalendarAiConfig = {
  ratios: RATIO_DEFAULTS,
  preset: "random",
  customPrompt: "",
  arcEnabled: false,
  arcChance: 60,
  arcCycleDays: 7,
  arcNature: "工作合作 / 感情发展 / 家庭 / 个人目标",
  arcClue: "",
};

function ownerKey(ownerType: CalendarOwnerType, ownerId: string): string {
  return `${ownerType}:${ownerId}`;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function cleanText(value: unknown, maxLength: number): string {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, maxLength);
}

function normalizeRatios(raw: unknown): Record<string, number> {
  const record = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const next: Record<string, number> = {};
  for (const tag of DEFAULT_EVENT_TYPE_TAGS) {
    next[tag.id] = clampNumber(record[tag.id], 0, 100, RATIO_DEFAULTS[tag.id] ?? 0);
  }
  return next;
}

function normalizeConfig(raw: unknown): CalendarAiConfig {
  const record = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const preset = ["busy_work", "leisure", "random", "custom"].includes(String(record.preset))
    ? String(record.preset) as CalendarGenerationPreset
    : "random";
  return {
    ratios: normalizeRatios(record.ratios),
    preset,
    customPrompt: cleanText(record.customPrompt, 1200),
    arcEnabled: record.arcEnabled === true,
    arcChance: clampNumber(record.arcChance, 0, 100, DEFAULT_CALENDAR_AI_CONFIG.arcChance),
    arcCycleDays: clampNumber(record.arcCycleDays, 1, 90, DEFAULT_CALENDAR_AI_CONFIG.arcCycleDays),
    arcNature: cleanText(record.arcNature, 200) || DEFAULT_CALENDAR_AI_CONFIG.arcNature,
    arcClue: cleanText(record.arcClue, 600),
  };
}

export function loadCalendarAiConfig(ownerType: CalendarOwnerType, ownerId: string): CalendarAiConfig {
  if (typeof window === "undefined") return DEFAULT_CALENDAR_AI_CONFIG;
  try {
    const raw = kvGet(CONFIG_KEY);
    if (!raw) return DEFAULT_CALENDAR_AI_CONFIG;
    const parsed = JSON.parse(raw) as Partial<PersistedConfigStore>;
    const config = parsed.configs?.[ownerKey(ownerType, ownerId)];
    return config ? normalizeConfig(config) : DEFAULT_CALENDAR_AI_CONFIG;
  } catch {
    return DEFAULT_CALENDAR_AI_CONFIG;
  }
}

export function saveCalendarAiConfig(
  ownerType: CalendarOwnerType,
  ownerId: string,
  config: CalendarAiConfig,
): CalendarAiConfig {
  if (typeof window === "undefined") return config;
  let store: PersistedConfigStore = { configs: {} };
  try {
    const raw = kvGet(CONFIG_KEY);
    const parsed = raw ? JSON.parse(raw) as Partial<PersistedConfigStore> : null;
    if (parsed?.configs && typeof parsed.configs === "object") store = { configs: parsed.configs };
  } catch {
    // ignore corrupt store, overwrite below
  }
  const normalized = normalizeConfig(config);
  store.configs[ownerKey(ownerType, ownerId)] = normalized;
  kvSet(CONFIG_KEY, JSON.stringify(store));
  return normalized;
}

function normalizeArc(raw: unknown): CalendarStoryArc | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const id = cleanText(record.id, 120);
  const ownerId = cleanText(record.ownerId, 160);
  const title = cleanText(record.title, 80);
  if (!id || !ownerId || !title) return null;
  const now = new Date().toISOString();
  return {
    id,
    ownerType: record.ownerType === "user" ? "user" : "character",
    ownerId,
    title,
    nature: cleanText(record.nature, 120),
    clue: cleanText(record.clue, 600),
    stage: cleanText(record.stage, 200) || "刚刚开始",
    status: record.status === "ended" ? "ended" : "active",
    startedAt: typeof record.startedAt === "string" ? record.startedAt : now,
    expectedEndAt: typeof record.expectedEndAt === "string" ? record.expectedEndAt : now,
    lastAdvancedAt: typeof record.lastAdvancedAt === "string" ? record.lastAdvancedAt : now,
    history: Array.isArray(record.history)
      ? record.history
          .map((item): { date: string; note: string } | null => {
            if (!item || typeof item !== "object") return null;
            const row = item as Record<string, unknown>;
            const date = cleanText(row.date, 10);
            const note = cleanText(row.note, 240);
            return date && note ? { date, note } : null;
          })
          .filter((item): item is { date: string; note: string } => Boolean(item))
          .slice(-20)
      : [],
  };
}

function loadArcStore(): PersistedArcStore {
  if (typeof window === "undefined") return { arcs: [] };
  try {
    const raw = kvGet(ARC_KEY);
    if (!raw) return { arcs: [] };
    const parsed = JSON.parse(raw) as Partial<PersistedArcStore>;
    return {
      arcs: Array.isArray(parsed.arcs)
        ? parsed.arcs.map(normalizeArc).filter((item): item is CalendarStoryArc => Boolean(item))
        : [],
    };
  } catch {
    return { arcs: [] };
  }
}

function saveArcStore(arcs: CalendarStoryArc[]): void {
  if (typeof window === "undefined") return;
  kvSet(ARC_KEY, JSON.stringify({ arcs: arcs.slice(0, 100) }));
}

export function loadActiveCalendarArcs(ownerType: CalendarOwnerType, ownerId: string): CalendarStoryArc[] {
  return loadArcStore().arcs
    .filter(arc => arc.ownerType === ownerType && arc.ownerId === ownerId && arc.status === "active")
    .sort((a, b) => b.lastAdvancedAt.localeCompare(a.lastAdvancedAt));
}

export function saveCalendarArc(arc: CalendarStoryArc): CalendarStoryArc {
  const normalized = normalizeArc(arc);
  if (!normalized) throw new Error("大事件状态无效");
  const store = loadArcStore();
  const next = store.arcs.filter(item => item.id !== normalized.id);
  next.push(normalized);
  saveArcStore(next);
  return normalized;
}

export function endCalendarArc(arcId: string): void {
  const store = loadArcStore();
  saveArcStore(store.arcs.map(arc => arc.id === arcId
    ? { ...arc, status: "ended" as const, lastAdvancedAt: new Date().toISOString() }
    : arc));
}

export function buildArcPromptBlock(ownerType: CalendarOwnerType, ownerId: string): string {
  const arcs = loadActiveCalendarArcs(ownerType, ownerId);
  if (arcs.length === 0) return "当前没有正在进行的大事件。";
  return arcs.map((arc, index) => [
    `大事件 ${index + 1}：${arc.title}`,
    `- 性质：${arc.nature || "未设定"}`,
    `- 线索：${arc.clue || "无"}`,
    `- 当前阶段：${arc.stage}`,
    `- 开始：${arc.startedAt.slice(0, 10)}，预计周期：${arc.expectedEndAt.slice(0, 10)}`,
    `- 最近进展：${arc.history.at(-1)?.note ?? "尚未推进"}`,
  ].join("\n")).join("\n\n");
}

export function getCalendarRatioLabel(ratios: Record<string, number>): string {
  return DEFAULT_EVENT_TYPE_TAGS
    .map(tag => `${tag.label} ${Math.round(ratios[tag.id] ?? 0)}%`)
    .filter(line => !line.endsWith(" 0%"))
    .join("；");
}
