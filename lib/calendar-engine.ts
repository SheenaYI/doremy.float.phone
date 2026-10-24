import type { Character } from "./character-types";
import type { ApiConfig, PresetConfig, RegexConfig, WorldBookConfig } from "./settings-types";
import type { UserIdentity } from "@/components/settings/user-identity";
import type { AssemblerInput, LLMMessage } from "./llm-prompt-assembler";
import type { CalendarOwnerType, CalendarScheduleItem } from "./calendar-types";
import { loadCharacters } from "./character-storage";
import {
  loadBindingConfig,
  loadApiConfigs,
  loadPresets,
  loadWorldBooks,
  loadRegexes,
  resolveBinding,
  resolveUserIdentity,
} from "./settings-storage";
import { assemblePromptPayload } from "./llm-prompt-assembler";
import { loadMemoryConfig } from "./memory-storage";
import { retrieveCoreMemoriesForPrompt, retrieveMemoriesForPrompt } from "./memory-service";
import { formatCoreMemories, formatLongTermMemories } from "./memory-injector";
import { prepareShortTermContext } from "./short-term-assembler";
import { getCustomStickerExample, getCustomStickerNames } from "./custom-sticker-storage";
import { previewMessagesForApi, sendLLMRequest, type ChatEngineError } from "./chat-engine";
import { applyGeneratedScheduleRange, buildCalendarScheduleMarker, cloneWeekPlanWithManualEdits, normalizeGeneratedScheduleItems } from "./calendar-storage";
import {
  formatIsoDate,
  getWeekDates,
  getWeekStartIso,
  getWeekdayLabel,
  isCalendarTimeRangeAllowed,
  parseIsoDate,
  normalizeTime,
  sanitizeScheduleEmoji,
} from "./calendar-utils";
import {
  CALENDAR_GENERATION_PRESETS,
  buildArcPromptBlock,
  getCalendarRatioLabel,
  loadCalendarAiConfig,
  type CalendarAiConfig,
} from "./calendar-ai-config";

type CalendarAssemblerResolved = {
  apiConfig: ApiConfig;
  preset: PresetConfig | null;
  regexes: RegexConfig[];
  llmMessages: LLMMessage[];
  ownerName: string;
};

function buildSyntheticUserCharacter(identity: UserIdentity | null): Character {
  const now = new Date().toISOString();
  const personaLines = [
    identity?.bio?.trim(),
    identity?.occupation ? `职业：${identity.occupation}` : "",
    identity?.age ? `年龄：${identity.age}` : "",
    identity?.gender && identity.gender !== "保密" ? `性别：${identity.gender}` : "",
    identity?.customSettings?.trim(),
  ].filter(Boolean);

  return {
    id: "__calendar_user__",
    name: identity?.name?.trim() || "用户",
    avatar: identity?.avatarUrl || null,
    persona: personaLines.join("\n") || "这是用户本人。",
    wechatID: "",
    createdAt: now,
    updatedAt: now,
  };
}

function buildCalendarTriggerInstruction(
  ownerName: string,
  weekDates: string[],
  options?: { config?: CalendarAiConfig; arcBlock?: string },
): string {
  const config = options?.config;
  const preset = config
    ? CALENDAR_GENERATION_PRESETS.find(item => item.id === config.preset) ?? CALENDAR_GENERATION_PRESETS[2]
    : null;
  const lines = [
    `请为${ownerName}生成 ${weekDates[0]} 到 ${weekDates[weekDates.length - 1]} 这 ${weekDates.length} 天的日程安排。`,
    "请参考已有日程，生成这一周的完整日程安排。",
  ];
  if (config) {
    lines.push(`行程类型倾向（软约束，不必机械分配到每一天）：${getCalendarRatioLabel(config.ratios)}。`);
    if (preset) lines.push(`本周基调：${preset.label}。${preset.desc}。`);
    if (config.arcEnabled) {
      lines.push(
        "本周允许推进正在进行的大事件；大事件只作为背景线索，不要为了推进而每天硬塞相关内容，也不要凭空结束它。",
        options?.arcBlock || "当前没有正在进行的大事件。",
      );
      if (config.arcClue.trim()) lines.push(`用户补充的事件线索：${config.arcClue.trim()}`);
    }
    if (config.customPrompt.trim()) lines.push(`用户额外要求：${config.customPrompt.trim()}`);
  }
  lines.push(
    "每行一条，格式：YYYY-MM-DD|周几|开始时间|结束时间|地点|emoji|事项。emoji 段填一个最贴合该事项的表情符号。",
    "作息时间不受限制（早起、夜跑、通宵都可以安排），但每一天最多 5 条日程，宁缺毋滥。",
  );
  return lines.join("\n");
}

function stripCodeFences(text: string): string {
  return text
    .replace(/^```[a-zA-Z]*\s*/g, "")
    .replace(/\s*```$/g, "")
    .trim();
}

function parseScheduleLinesForDates(rawText: string, allowedDates: Set<string>): CalendarScheduleItem[] {
  const lines = stripCodeFences(rawText)
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  const parsed: Array<{
    date: string;
    startTime: string;
    endTime: string;
    location: string;
    title: string;
    emoji?: string;
  }> = [];

  for (const rawLine of lines) {
    const line = rawLine
      .replace(/^[-*]\s*/, "")
      .replace(/^\d+[.)、]\s*/, "")
      .trim();
    if (!line.includes("|")) continue;
    const parts = line.split("|").map(part => part.trim());
    if (parts.length < 6) continue;

    const date = parts[0];
    const startTime = normalizeTime(parts[2]);
    const endTime = normalizeTime(parts[3]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !allowedDates.has(date)) continue;
    if (!startTime || !endTime || !isCalendarTimeRangeAllowed(startTime, endTime)) continue;

    const location = parts[4] === "无" ? "" : parts[4];
    // 新格式第 6 段为 emoji（YYYY-MM-DD|周几|开始|结束|地点|emoji|事项）；
    // 兼容旧格式（第 6 段直接是事项）：仅当该段确实是 emoji 时才按新格式取。
    let emoji = "";
    let title: string;
    if (parts.length >= 7) {
      const candidate = sanitizeScheduleEmoji(parts[5]);
      if (candidate && Array.from(parts[5]).length <= 3) {
        emoji = candidate;
        title = parts.slice(6).join("|");
      } else {
        title = parts.slice(5).join("|");
      }
    } else {
      title = parts[5];
    }
    if (!title.trim()) continue;

    parsed.push({
      date,
      startTime,
      endTime,
      location,
      title,
      emoji,
    });
  }

  return normalizeGeneratedScheduleItems(parsed);
}

function parseScheduleLines(rawText: string, weekStart: string): CalendarScheduleItem[] {
  return parseScheduleLinesForDates(rawText, new Set(getWeekDates(weekStart)));
}

type CalendarResolveOptions = {
  appTags?: string[];
  scheduleSummary?: string;
  excludeGenerated?: boolean;
};

export async function resolveCalendarAssemblerInput(
  ownerType: CalendarOwnerType,
  ownerId: string,
  weekStart: string,
  options?: CalendarResolveOptions,
): Promise<CalendarAssemblerResolved> {
  const bindings = loadBindingConfig();
  const activeSlot = resolveBinding(bindings, ownerType === "character" ? ownerId : undefined, "calendar");

  if (!activeSlot.apiConfigId) {
    throw new Error("未绑定日历 API，请先在配置绑定中为日历设置 API。");
  }

  const apiConfigs = loadApiConfigs();
  const apiConfig = apiConfigs.find(entry => entry.id === activeSlot.apiConfigId);
  if (!apiConfig) {
    throw new Error("日历 API 配置不存在。");
  }

  const presets = loadPresets();
  let preset = activeSlot.presetId ? presets.find(entry => entry.id === activeSlot.presetId) ?? null : null;
  if (!preset) preset = presets.find(entry => entry.builtIn) ?? null;

  const allWorldBooks = loadWorldBooks();
  const worldBooks = (activeSlot.worldBookIds || [])
    .map(id => allWorldBooks.find(entry => entry.id === id))
    .filter(Boolean) as WorldBookConfig[];

  const allRegexes = loadRegexes();
  const regexes = (activeSlot.regexIds || [])
    .map(id => allRegexes.find(entry => entry.id === id))
    .filter(Boolean) as RegexConfig[];

  const userIdentity = resolveUserIdentity(ownerType === "character" ? ownerId : undefined, "calendar");
  const character =
    ownerType === "character"
      ? loadCharacters().find(entry => entry.id === ownerId)
      : buildSyntheticUserCharacter(resolveUserIdentity(undefined, "calendar"));

  if (!character) {
    throw new Error("日历目标不存在。");
  }

  const memConfig = loadMemoryConfig();
  let coreMemories = "";
  let longTermMemories = "";
  let recentBlocks: import("./short-term-assembler").RecentBlock[] = [];
  let unifiedRecentItems: import("./short-term-assembler").UnifiedRecentItem[] = [];
  let wbActivationContext = "";

  if (ownerType === "character") {
    const prepared = prepareShortTermContext(ownerId, "calendar", { history: [] });
    recentBlocks = prepared.recentBlocks;
    unifiedRecentItems = prepared.unifiedRecentItems;
    wbActivationContext = prepared.wbActivationContext;
    const [coreResults, longResults] = await Promise.all([
      retrieveCoreMemoriesForPrompt(ownerId, memConfig).catch(() => []),
      retrieveMemoriesForPrompt(ownerId, wbActivationContext, memConfig).catch(() => []),
    ]);
    coreMemories = formatCoreMemories(coreResults);
    longTermMemories = formatLongTermMemories(longResults);
  }

  const scheduleSummary = options?.scheduleSummary
    ?? buildCalendarScheduleMarker(ownerType, ownerId, weekStart, { excludeGenerated: options?.excludeGenerated });
  const llmMessages = assemblePromptPayload({
    character,
    history: [],
    preset,
    worldBooks,
    regexes,
    userIdentity,
    appId: "calendar",
    ...(options?.appTags ? { appTags: options.appTags } : {}),
    scheduleSummary,
    coreMemories,
    longTermMemories,
    worldBookActivationContext: wbActivationContext || undefined,
    recentBlocks,
    unifiedRecentItems,
    customStickerNames: ownerType === "character" ? getCustomStickerNames(ownerId) : "",
    customStickerExample: ownerType === "character" ? getCustomStickerExample(ownerId) : "",
  } as AssemblerInput);

  return {
    apiConfig,
    preset,
    regexes,
    llmMessages,
    ownerName: character.name,
  };
}

function getCalendarRangeDates(startDate: string, endDate: string): string[] {
  const start = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return [];
  const dates: string[] = [];
  for (let cursor = start.getTime(); cursor <= end.getTime() && dates.length < 62; cursor += 86_400_000) {
    dates.push(formatIsoDate(new Date(cursor)));
  }
  return dates;
}

async function requestCalendarScheduleRange(
  ownerType: CalendarOwnerType,
  ownerId: string,
  startDate: string,
  endDate: string,
  save: boolean,
): Promise<{ success: boolean; error?: string; items?: CalendarScheduleItem[] }> {
  if (ownerType !== "character") {
    return { success: false, error: "用户日程不支持 AI 生成，请手动填写。" };
  }
  const dates = getCalendarRangeDates(startDate, endDate);
  if (dates.length === 0) {
    return { success: false, error: "日期范围无效。" };
  }
  const weekStart = getWeekStartIso(parseIsoDate(startDate));
  try {
    // 只把手动条目带进提示词：旧 AI 结果不参与组装，避免"重新生成"照抄旧日程；
    // 但不再先在存储里删除旧结果，生成失败或中途退出不会丢数据。
    const resolved = await resolveCalendarAssemblerInput(ownerType, ownerId, weekStart, { excludeGenerated: true });
    const aiConfig = loadCalendarAiConfig(ownerType, ownerId);
    const triggerInstruction = buildCalendarTriggerInstruction(resolved.ownerName, dates, {
      config: aiConfig,
      arcBlock: aiConfig.arcEnabled ? buildArcPromptBlock(ownerType, ownerId) : undefined,
    });

    const messages: LLMMessage[] = [
      ...resolved.llmMessages,
      {
        role: "user",
        content: triggerInstruction,
        _debugMeta: { marker: "calendar_trigger" },
      },
    ];

    const rawText = await sendLLMRequest(
      resolved.apiConfig,
      resolved.preset,
      messages,
      resolved.regexes,
      { characterName: `日历:${resolved.ownerName}` },
      { appId: "calendar", appTags: ["calendar"] },
    );

    const items = parseScheduleLinesForDates(rawText, new Set(dates));
    if (items.length === 0) {
      return { success: false, error: "日历生成结果为空，或格式无法解析。" };
    }
    if (save) {
      if (dates.length === 7 && startDate === weekStart) {
        cloneWeekPlanWithManualEdits(ownerType, ownerId, weekStart, items);
      } else {
        applyGeneratedScheduleRange(ownerType, ownerId, startDate, endDate, items);
      }
    }
    return { success: true, items };
  } catch (error) {
    const err = error as ChatEngineError | Error;
    return { success: false, error: err?.message || "生成日历失败" };
  }
}

export async function generateWeeklyCalendarSchedule(
  ownerType: CalendarOwnerType,
  ownerId: string,
  weekStart: string,
): Promise<{ success: boolean; error?: string; items?: CalendarScheduleItem[] }> {
  const dates = getWeekDates(weekStart);
  return requestCalendarScheduleRange(ownerType, ownerId, dates[0], dates[6], true);
}

export async function previewWeeklyCalendarSchedule(
  ownerType: CalendarOwnerType,
  ownerId: string,
  weekStart: string,
): Promise<{ success: boolean; error?: string; items?: CalendarScheduleItem[] }> {
  const dates = getWeekDates(weekStart);
  return requestCalendarScheduleRange(ownerType, ownerId, dates[0], dates[6], false);
}

export async function previewCalendarScheduleRange(
  ownerType: CalendarOwnerType,
  ownerId: string,
  startDate: string,
  endDate: string,
): Promise<{ success: boolean; error?: string; items?: CalendarScheduleItem[] }> {
  return requestCalendarScheduleRange(ownerType, ownerId, startDate, endDate, false);
}

export async function generateCalendarScheduleRange(
  ownerType: CalendarOwnerType,
  ownerId: string,
  startDate: string,
  endDate: string,
): Promise<{ success: boolean; error?: string; items?: CalendarScheduleItem[] }> {
  return requestCalendarScheduleRange(ownerType, ownerId, startDate, endDate, true);
}

export async function previewCalendarPromptPayload(
  ownerType: CalendarOwnerType,
  ownerId: string,
  weekStart: string,
): Promise<{ messages: LLMMessage[]; characterName: string; model: string; presetName: string }> {
  if (ownerType !== "character") {
    throw new Error("用户日程不支持 AI 生成预览。");
  }
  const resolved = await resolveCalendarAssemblerInput(ownerType, ownerId, weekStart, { excludeGenerated: true });
  const weekDates = getWeekDates(weekStart);
  const aiConfig = loadCalendarAiConfig(ownerType, ownerId);
  const triggerInstruction = buildCalendarTriggerInstruction(resolved.ownerName, weekDates, {
    config: aiConfig,
    arcBlock: aiConfig.arcEnabled ? buildArcPromptBlock(ownerType, ownerId) : undefined,
  });

  const messages: LLMMessage[] = [
    ...resolved.llmMessages,
    {
      role: "user",
      content: triggerInstruction,
      _debugMeta: { marker: "calendar_trigger" },
    },
  ];

  const apiMessages = previewMessagesForApi(resolved.apiConfig, resolved.preset, messages);
  return {
    messages: apiMessages,
    characterName: `日历:${resolved.ownerName}`,
    model: resolved.apiConfig.defaultModel,
    presetName: resolved.preset?.name ?? "(无预设)",
  };
}

export function createDefaultScheduleDraft(date: string) {
  return {
    date,
    weekday: getWeekdayLabel(date),
    startTime: "09:00",
    endTime: "10:00",
    location: "",
    title: "",
    emoji: "",
    source: "manual" as const,
  };
}

export function getCurrentWeekStart(): string {
  return getWeekStartIso(new Date());
}
