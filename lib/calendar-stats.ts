import type { CalendarOwnerType, CalendarScheduleItem, CalendarWeekPlan } from "./calendar-types";
import type { CalendarDayRecord, CalendarExperience, CalendarExperienceImage } from "./calendar-day-types";
import { getWeekDates } from "./calendar-utils";

export type CalendarWeekStats = {
  weekStart: string;
  dates: string[];
  totalSchedules: number;
  totalExtras: number;
  totalExperiences: number;
  eventTypeCounts: Array<{ id: string; count: number }>;
  moodTypeCounts: Array<{ id: string; count: number }>;
  dailyMood: Array<{ date: string; mood: number | null }>;
  eventMoodMatrix: Array<{ eventTypeId: string; moods: Record<string, number>; total: number }>;
  busiestDay: { date: string; count: number } | null;
  happiestDay: { date: string; mood: number } | null;
  images: Array<{ experience: CalendarExperience; image: CalendarExperienceImage }>;
  scheduleItems: CalendarScheduleItem[];
  experiences: CalendarExperience[];
};

export function computeCalendarWeekStats(params: {
  ownerType: CalendarOwnerType;
  ownerId: string;
  weekStart: string;
  plans: CalendarWeekPlan[];
  dayRecords: CalendarDayRecord[];
}): CalendarWeekStats {
  const dates = getWeekDates(params.weekStart);
  const dateSet = new Set(dates);
  const plan = params.plans.find(item =>
    item.ownerType === params.ownerType
    && item.ownerId === params.ownerId
    && item.weekStart === params.weekStart
  );
  const scheduleItems = (plan?.items ?? []).filter(item => dateSet.has(item.date));
  const records = params.dayRecords.filter(record => dateSet.has(record.date));
  const experiences = records.flatMap(record => record.experiences);
  const extras = experiences.filter(item => item.kind === "extra");

  const eventTypeMap = new Map<string, number>();
  const moodTypeMap = new Map<string, number>();
  const matrixMap = new Map<string, { moods: Record<string, number>; total: number }>();
  for (const experience of experiences) {
    eventTypeMap.set(experience.eventTypeId, (eventTypeMap.get(experience.eventTypeId) ?? 0) + 1);
    moodTypeMap.set(experience.moodTypeId, (moodTypeMap.get(experience.moodTypeId) ?? 0) + 1);
    const matrix = matrixMap.get(experience.eventTypeId) ?? { moods: {}, total: 0 };
    matrix.moods[experience.moodTypeId] = (matrix.moods[experience.moodTypeId] ?? 0) + 1;
    matrix.total += 1;
    matrixMap.set(experience.eventTypeId, matrix);
  }

  const dailyMood = dates.map(date => ({
    date,
    mood: records.find(record => record.date === date)?.mood ?? null,
  }));

  const dayCounts = dates.map(date => ({
    date,
    count: scheduleItems.filter(item => item.date === date).length
      + experiences.filter(item => item.date === date && item.kind === "extra").length,
  })).sort((a, b) => b.count - a.count || a.date.localeCompare(b.date));

  const moodDays = dailyMood
    .filter(item => item.mood !== null)
    .sort((a, b) => (b.mood ?? 0) - (a.mood ?? 0) || a.date.localeCompare(b.date));
  const happiest = moodDays[0];

  const images = experiences.flatMap(experience =>
    experience.images.map(image => ({ experience, image })),
  );

  return {
    weekStart: params.weekStart,
    dates,
    totalSchedules: scheduleItems.length,
    totalExtras: extras.length,
    totalExperiences: experiences.length,
    eventTypeCounts: [...eventTypeMap.entries()]
      .map(([id, count]) => ({ id, count }))
      .sort((a, b) => b.count - a.count),
    moodTypeCounts: [...moodTypeMap.entries()]
      .map(([id, count]) => ({ id, count }))
      .sort((a, b) => b.count - a.count),
    dailyMood,
    eventMoodMatrix: [...matrixMap.entries()]
      .map(([eventTypeId, value]) => ({ eventTypeId, ...value }))
      .sort((a, b) => b.total - a.total),
    busiestDay: dayCounts[0]?.count > 0 ? dayCounts[0] : null,
    happiestDay: happiest?.mood != null ? { date: happiest.date, mood: happiest.mood } : null,
    images,
    scheduleItems,
    experiences,
  };
}
