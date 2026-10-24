import { jsonrepair } from "jsonrepair";
import type { CalendarOwnerType, CalendarScheduleItem } from "./calendar-types";
import type {
  CalendarDailyMood,
  CalendarExperience,
  CalendarTagConfig,
} from "./calendar-day-types";
import {
  createCalendarExperienceDraft,
  getCalendarTagLabel,
  loadCalendarDayRecord,
  loadCalendarTagConfig,
} from "./calendar-day-storage";
import { loadCalendarWeekPlan, formatCalendarScheduleItemForPrompt } from "./calendar-storage";
import { formatIsoDate, getWeekStartIso, parseIsoDate, timeToMinutes } from "./calendar-utils";
import { loadChatMessages, loadChatSessions } from "./chat-storage";
import { previewMessagesForApi, sendLLMRequest, type ChatEngineError } from "./chat-engine";
import { resolveCalendarAssemblerInput } from "./calendar-engine";

export type CalendarDayReviewDraft = {
  mood: CalendarDailyMood | null;
  keywords: string[];
  summary: string;
  experiences: CalendarExperience[];
};

export type CalendarDayReviewResult =
  | { success: true; review: CalendarDayReviewDraft }
  | { success: false; error: string };

function cleanText(value: unknown, maxLength: number): string {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, maxLength);
}

function cleanMultiline(value: unknown, maxLength: number): string {
  return cleanText(value, maxLength).replace(/\\n/g, "\n");
}

function normalizeMood(value: unknown): CalendarDailyMood | null {
  const number = typeof value === "number" ? Math.round(value) : Number(value);
  if (!Number.isFinite(number)) return null;
  const clamped = Math.max(1, Math.min(5, Math.round(number)));
  return clamped as CalendarDailyMood;
}

function normalizeKeywords(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,，、/|]+/) : [];
  return Array.from(new Set(raw.map(item => cleanText(item, 16)).filter(Boolean))).slice(0, 6);
}

function parseJsonObject(content: string): Record<string, unknown> | null {
  const candidate = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    const parsed = JSON.parse(candidate);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    try {
      const repaired = JSON.parse(jsonrepair(candidate));
      return repaired && typeof repaired === "object" && !Array.isArray(repaired) ? repaired as Record<string, unknown> : null;
    } catch {
      return null;
    }
  }
}

function resolveTagId(config: CalendarTagConfig, kind: "event" | "mood", raw: unknown, fallback: string): string {
  const value = cleanText(raw, 60);
  if (!value) return fallback;
  const list = kind === "event" ? config.eventTypes : config.moods;
  const direct = list.find(tag => tag.id === value);
  if (direct) return direct.id;
  const byLabel = list.find(tag => tag.label === value);
  return byLabel?.id ?? fallback;
}

function endedScheduleItems(items: CalendarScheduleItem[], date: string): CalendarScheduleItem[] {
  const today = formatIsoDate(new Date());
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  return items.filter(item => {
    if (item.date !== date) return false;
    if (date < today) return true;
    if (date > today) return false;
    const end = timeToMinutes(item.endTime);
    return !Number.isNaN(end) && end <= currentMinutes;
  });
}

function formatDayScheduleContext(
  date: string,
  items: CalendarScheduleItem[],
  existing: CalendarExperience[],
): string {
  const scheduleLines = items.length > 0
    ? items.map(item => `- id=${item.id}｜${formatCalendarScheduleItemForPrompt(item)}${item.emoji ? `｜${item.emoji}` : ""}`).join("\n")
    : "（这一天没有既定行程）";
  const experienceLines = existing.length > 0
    ? existing.map(item => `- ${item.startTime} ${item.title}（${getCalendarTagLabel(loadCalendarTagConfig(), "event", item.eventTypeId)}）`).join("\n")
    : "（还没有已记录的经历）";
  return [
    `日期：${date}`,
    "当天既定行程（已结束，可补写实际经历）：",
    scheduleLines,
    "当天已有经历（不要重复生成）：",
    experienceLines,
  ].join("\n");
}

function buildChatExcerpt(characterId: string, date: string): string {
  const sessions = loadChatSessions()
    .filter(session => !session.isGroup && session.contactId === characterId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (sessions.length === 0) return "";
  const session = sessions[0];
  const messages = loadChatMessages(session.id)
    .filter(message => message.role === "user" || message.role === "assistant")
    .filter(message => {
      const time = Date.parse(message.createdAt);
      return Number.isFinite(time) && formatIsoDate(new Date(time)) === date;
    })
    .slice(-40);
  if (messages.length === 0) return "";
  return messages.map(message => {
    const role = message.role === "user" ? "用户" : "角色";
    const time = new Date(message.createdAt);
    const clock = `${String(time.getHours()).padStart(2, "0")}:${String(time.getMinutes()).padStart(2, "0")}`;
    return `[${clock}] ${role}：${cleanText(message.content, 160)}`;
  }).join("\n");
}

function buildDayReviewInstruction(params: {
  date: string;
  ownerName: string;
  scheduleText: string;
  tagConfig: CalendarTagConfig;
  includeChat: boolean;
  chatExcerpt: string;
  extraHint: string;
}): string {
  const eventIds = params.tagConfig.eventTypes.map(tag => `${tag.id}=${tag.label}`).join("，");
  const moodIds = params.tagConfig.moods.map(tag => `${tag.id}=${tag.label}`).join("，");
  const lines = [
    `请为${params.ownerName}回顾 ${params.date} 这一天。`,
    "你只负责补写已经结束的行程的实际经历，以及适量的额外经历；不要编造与已有聊天/记忆冲突的事实。",
    "",
    params.scheduleText,
    "",
    params.includeChat && params.chatExcerpt
      ? `当天私聊片段（只作为事实参考，不要逐句复述）：\n${params.chatExcerpt}`
      : "不参考聊天记录。",
    params.extraHint.trim() ? `用户额外要求：${params.extraHint.trim()}` : "",
    "",
    "输出规则：",
    "- 只输出一个 JSON 对象，不要 Markdown、解释或代码块",
    "- mood 是当天总体心情，1=很糟，2=低落，3=平静，4=不错，5=很好",
    "- keywords 是 2-5 个今日关键词；summary 是第一人称或第三人称的简短今日小结，120 字以内",
    "- experiences 是经历数组：为每条已结束的既定行程补一条（linkedScheduleId 必须使用上面给出的 id），再生成 0-3 条额外经历（不填 linkedScheduleId）",
    "- 每条经历必须有 title、startTime（HH:MM）、eventTypeId、moodTypeId、note（40-160 字，写实际发生的事和感受）",
    "- endTime 可选；额外经历不要与已有行程时间严重冲突",
    "- 不要重复已有经历；不要为还没结束的行程生成经历",
    `- eventTypeId 只能从这些里选：${eventIds}`,
    `- moodTypeId 只能从这些里选：${moodIds}`,
    "",
    "JSON 格式：",
    '{"mood":4,"keywords":["忙碌","意外","惦念"],"summary":"……","experiences":[{"linkedScheduleId":"日程id","title":"晨间会议","startTime":"08:30","endTime":"09:30","eventTypeId":"work","moodTypeId":"calm","note":"……"}]}',
  ];
  return lines.filter(Boolean).join("\n");
}

export async function previewCalendarDayReview(params: {
  ownerType: CalendarOwnerType;
  ownerId: string;
  date: string;
  includeChat: boolean;
  extraHint?: string;
}): Promise<CalendarDayReviewResult> {
  if (params.ownerType !== "character") {
    return { success: false, error: "用户日程暂不支持 AI 生成，请手动记录。" };
  }
  try {
    const weekStart = getWeekStartIso(parseIsoDate(params.date));
    const plan = loadCalendarWeekPlan("character", params.ownerId, weekStart);
    const scheduleItems = endedScheduleItems(plan?.items ?? [], params.date);
    const dayRecord = loadCalendarDayRecord("character", params.ownerId, params.date);
    const existing = dayRecord?.experiences ?? [];
    const tagConfig = loadCalendarTagConfig();
    const scheduleText = formatDayScheduleContext(params.date, scheduleItems, existing);
    const chatExcerpt = params.includeChat ? buildChatExcerpt(params.ownerId, params.date) : "";
    const resolved = await resolveCalendarAssemblerInput("character", params.ownerId, weekStart, {
      appTags: ["calendar_day"],
      scheduleSummary: [
        `当前回顾日期：${params.date}`,
        "当天安排：",
        scheduleText,
      ].join("\n"),
    });
    const instruction = buildDayReviewInstruction({
      date: params.date,
      ownerName: resolved.ownerName,
      scheduleText,
      tagConfig,
      includeChat: params.includeChat,
      chatExcerpt,
      extraHint: params.extraHint ?? "",
    });
    const messages = [
      ...resolved.llmMessages,
      { role: "user" as const, content: instruction, _debugMeta: { marker: "calendar_day_trigger" } },
    ];
    const raw = await sendLLMRequest(
      resolved.apiConfig,
      resolved.preset,
      messages,
      resolved.regexes,
      { characterName: `日历回顾:${resolved.ownerName}` },
      { appId: "calendar", appTags: ["calendar_day"] },
    );
    const parsed = parseJsonObject(raw);
    if (!parsed) return { success: false, error: "回顾结果无法解析为 JSON。" };
    const rawExperiences = Array.isArray(parsed.experiences) ? parsed.experiences : [];
    const scheduleIds = new Set(scheduleItems.map(item => item.id));
    const seenScheduleIds = new Set<string>();
    const experiences: CalendarExperience[] = [];
    for (const rawExperience of rawExperiences) {
      if (!rawExperience || typeof rawExperience !== "object") continue;
      const record = rawExperience as Record<string, unknown>;
      const linkedScheduleId = cleanText(record.linkedScheduleId, 160) || undefined;
      const validLinked = linkedScheduleId && scheduleIds.has(linkedScheduleId) ? linkedScheduleId : undefined;
      if (validLinked && seenScheduleIds.has(validLinked)) continue;
      if (validLinked) seenScheduleIds.add(validLinked);
      const scheduleItem = validLinked ? scheduleItems.find(item => item.id === validLinked) : null;
      const draft = createCalendarExperienceDraft({
        date: params.date,
        startTime: cleanText(record.startTime, 5) || scheduleItem?.startTime || "12:00",
        endTime: cleanText(record.endTime, 5) || scheduleItem?.endTime,
        title: cleanText(record.title, 60) || scheduleItem?.title || "额外经历",
        kind: validLinked ? "schedule" : "extra",
        linkedScheduleId: validLinked,
      });
      draft.eventTypeId = resolveTagId(tagConfig, "event", record.eventTypeId, "daily");
      draft.moodTypeId = resolveTagId(tagConfig, "mood", record.moodTypeId, "calm");
      draft.note = cleanMultiline(record.note, 2000);
      draft.source = "generated";
      experiences.push(draft);
      if (experiences.length >= 12) break;
    }
    if (experiences.length === 0 && !parsed.summary) {
      return { success: false, error: "回顾结果为空，请重新生成。" };
    }
    return {
      success: true,
      review: {
        mood: normalizeMood(parsed.mood),
        keywords: normalizeKeywords(parsed.keywords),
        summary: cleanMultiline(parsed.summary, 1200),
        experiences,
      },
    };
  } catch (error) {
    const err = error as ChatEngineError | Error;
    return { success: false, error: err?.message || "生成每日回顾失败" };
  }
}

export async function previewCalendarSingleExperience(params: {
  ownerType: CalendarOwnerType;
  ownerId: string;
  date: string;
  scheduleItemId: string;
}): Promise<{ success: true; experience: CalendarExperience } | { success: false; error: string }> {
  if (params.ownerType !== "character") {
    return { success: false, error: "用户日程暂不支持 AI 生成，请手动记录。" };
  }
  try {
    const weekStart = getWeekStartIso(parseIsoDate(params.date));
    const plan = loadCalendarWeekPlan("character", params.ownerId, weekStart);
    const item = plan?.items.find(entry => entry.id === params.scheduleItemId && entry.date === params.date);
    if (!item) return { success: false, error: "找不到这条行程。" };
    const today = formatIsoDate(new Date());
    const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
    const endMinutes = timeToMinutes(item.endTime);
    const ended = params.date < today
      || (params.date === today && !Number.isNaN(endMinutes) && endMinutes <= nowMinutes);
    if (!ended) return { success: false, error: "这条行程还没结束，暂时不能补写经历。" };
    const dayRecord = loadCalendarDayRecord("character", params.ownerId, params.date);
    const existing = dayRecord?.experiences ?? [];
    const tagConfig = loadCalendarTagConfig();
    const resolved = await resolveCalendarAssemblerInput("character", params.ownerId, weekStart, {
      appTags: ["calendar_day"],
      scheduleSummary: [
        `当前回顾日期：${params.date}`,
        "要补写的行程：",
        `- id=${item.id}｜${formatCalendarScheduleItemForPrompt(item)}${item.emoji ? `｜${item.emoji}` : ""}`,
        "当天已有经历（不要重复）：",
        existing.length > 0
          ? existing.map(entry => `- ${entry.startTime} ${entry.title}`).join("\n")
          : "（还没有）",
      ].join("\n"),
    });
    const eventIds = tagConfig.eventTypes.map(tag => `${tag.id}=${tag.label}`).join("，");
    const moodIds = tagConfig.moods.map(tag => `${tag.id}=${tag.label}`).join("，");
    const instruction = [
      `请只为${resolved.ownerName}的这条已经结束的行程补写一条实际经历。`,
      `行程：${formatCalendarScheduleItemForPrompt(item)}`,
      "不要生成额外经历，不要修改今日心情或今日总结。",
      "只输出一个 JSON 对象，不要 Markdown、解释或代码块。",
      `eventTypeId 只能从这些里选：${eventIds}`,
      `moodTypeId 只能从这些里选：${moodIds}`,
      '格式：{"experience":{"title":"晨间会议","startTime":"08:30","endTime":"09:30","eventTypeId":"work","moodTypeId":"calm","note":"实际发生的事和感受，40-160字"}}',
    ].join("\n");
    const messages = [
      ...resolved.llmMessages,
      { role: "user" as const, content: instruction, _debugMeta: { marker: "calendar_single_experience" } },
    ];
    const raw = await sendLLMRequest(
      resolved.apiConfig,
      resolved.preset,
      messages,
      resolved.regexes,
      { characterName: `日历经历:${resolved.ownerName}` },
      { appId: "calendar", appTags: ["calendar_day"] },
    );
    const parsed = parseJsonObject(raw);
    if (!parsed) return { success: false, error: "生成结果无法解析。" };
    const record = parsed.experience && typeof parsed.experience === "object"
      ? parsed.experience as Record<string, unknown>
      : parsed;
    const draft = createCalendarExperienceDraft({
      date: params.date,
      startTime: cleanText(record.startTime, 5) || item.startTime,
      endTime: cleanText(record.endTime, 5) || item.endTime,
      title: cleanText(record.title, 60) || item.title,
      kind: "schedule",
      linkedScheduleId: item.id,
    });
    draft.eventTypeId = resolveTagId(tagConfig, "event", record.eventTypeId, "daily");
    draft.moodTypeId = resolveTagId(tagConfig, "mood", record.moodTypeId, "calm");
    draft.note = cleanMultiline(record.note, 2000);
    draft.source = "generated";
    if (!draft.note.trim()) return { success: false, error: "生成结果没有具体经历内容。" };
    return { success: true, experience: draft };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "生成经历失败" };
  }
}

export async function previewCalendarDayPrompt(params: {
  ownerType: CalendarOwnerType;
  ownerId: string;
  date: string;
  includeChat: boolean;
  extraHint?: string;
}): Promise<{ messages: import("./llm-prompt-assembler").LLMMessage[]; characterName: string; model: string; presetName: string }> {
  const weekStart = getWeekStartIso(parseIsoDate(params.date));
  const plan = loadCalendarWeekPlan("character", params.ownerId, weekStart);
  const scheduleItems = endedScheduleItems(plan?.items ?? [], params.date);
  const dayRecord = loadCalendarDayRecord("character", params.ownerId, params.date);
  const tagConfig = loadCalendarTagConfig();
  const scheduleText = formatDayScheduleContext(params.date, scheduleItems, dayRecord?.experiences ?? []);
  const resolved = await resolveCalendarAssemblerInput("character", params.ownerId, weekStart, {
    appTags: ["calendar_day"],
    scheduleSummary: `当前回顾日期：${params.date}\n当天安排：\n${scheduleText}`,
  });
  const instruction = buildDayReviewInstruction({
    date: params.date,
    ownerName: resolved.ownerName,
    scheduleText,
    tagConfig,
    includeChat: params.includeChat,
    chatExcerpt: params.includeChat ? buildChatExcerpt(params.ownerId, params.date) : "",
    extraHint: params.extraHint ?? "",
  });
  const messages = [
    ...resolved.llmMessages,
    { role: "user" as const, content: instruction, _debugMeta: { marker: "calendar_day_trigger" } },
  ];
  return {
    messages: previewMessagesForApi(resolved.apiConfig, resolved.preset, messages),
    characterName: `日历回顾:${resolved.ownerName}`,
    model: resolved.apiConfig.defaultModel,
    presetName: resolved.preset?.name ?? "(无预设)",
  };
}
