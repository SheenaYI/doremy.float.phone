import type { CalendarOwnerType } from "./calendar-types";
import type { CalendarWeekStats } from "./calendar-stats";
import { loadCalendarTagConfig, getCalendarTagLabel } from "./calendar-day-storage";
import { getCalendarDailyMoodMeta } from "./calendar-day-types";
import { resolveCalendarAssemblerInput } from "./calendar-engine";
import { sendLLMRequest } from "./chat-engine";

function buildStatsContext(stats: CalendarWeekStats): string {
  const config = loadCalendarTagConfig();
  const events = stats.eventTypeCounts
    .slice(0, 6)
    .map(item => `${getCalendarTagLabel(config, "event", item.id)} ${item.count} 次`)
    .join("、") || "暂无";
  const moods = stats.dailyMood
    .filter(item => item.mood !== null)
    .map(item => `${item.date} ${getCalendarDailyMoodMeta(item.mood as 1 | 2 | 3 | 4 | 5)?.label ?? ""}`)
    .join("；") || "暂无";
  return [
    `本周行程 ${stats.totalSchedules} 条，额外经历 ${stats.totalExtras} 条，已记录经历 ${stats.totalExperiences} 条。`,
    `事件类型：${events}。`,
    `每日心情：${moods}。`,
    stats.busiestDay ? `最忙碌的一天：${stats.busiestDay.date}（${stats.busiestDay.count} 项）。` : "",
    stats.happiestDay ? `最开心的一天：${stats.happiestDay.date}。` : "",
  ].filter(Boolean).join("\n");
}

export async function generateCalendarWeeklyReview(params: {
  ownerType: CalendarOwnerType;
  ownerId: string;
  weekStart: string;
  stats: CalendarWeekStats;
}): Promise<{ success: true; summary: string } | { success: false; error: string }> {
  if (params.ownerType !== "character") {
    return { success: false, error: "用户周报暂不支持 AI 生成。" };
  }
  try {
    const resolved = await resolveCalendarAssemblerInput(params.ownerType, params.ownerId, params.weekStart, {
      appTags: ["calendar_week_report"],
      scheduleSummary: `本周回顾数据（本地统计）：\n${buildStatsContext(params.stats)}`,
    });
    const messages = [
      ...resolved.llmMessages,
      {
        role: "user" as const,
        content: [
          `请为${resolved.ownerName}写一段本周回顾。`,
          buildStatsContext(params.stats),
          "",
          "要求：",
          "- 第一人称，150-300 字，像角色自己在本周结束时写下的复盘",
          "- 结合具体事件和心情，不要只复述数字",
          "- 不要输出标题、Markdown、列表或分析过程",
        ].join("\n"),
        _debugMeta: { marker: "calendar_week_report_trigger" },
      },
    ];
    const raw = await sendLLMRequest(
      resolved.apiConfig,
      resolved.preset,
      messages,
      resolved.regexes,
      { characterName: `日历周报:${resolved.ownerName}` },
      { appId: "calendar", appTags: ["calendar_week_report"] },
    );
    const summary = raw
      .replace(/^```[a-zA-Z]*\s*/g, "")
      .replace(/\s*```$/g, "")
      .trim()
      .slice(0, 1200);
    if (!summary) return { success: false, error: "本周回顾生成结果为空。" };
    return { success: true, summary };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "生成本周回顾失败" };
  }
}
