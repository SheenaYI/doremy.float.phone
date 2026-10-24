import { kvGet, kvSet, registerKvMigration } from "./kv-db";
import type { CalendarOwnerType } from "./calendar-types";

export type CalendarWeeklyReview = {
  id: string;
  ownerType: CalendarOwnerType;
  ownerId: string;
  weekStart: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
};

type PersistedStore = { reviews: CalendarWeeklyReview[] };

const KEY = "ai_phone_calendar_week_reviews_v1";
registerKvMigration(KEY);

function cleanText(value: unknown, maxLength: number): string {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, maxLength);
}

function normalize(raw: unknown): CalendarWeeklyReview | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const id = cleanText(record.id, 140);
  const ownerId = cleanText(record.ownerId, 160);
  const weekStart = cleanText(record.weekStart, 10);
  const summary = cleanText(record.summary, 1200);
  if (!id || !ownerId || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart) || !summary) return null;
  const now = new Date().toISOString();
  return {
    id,
    ownerType: record.ownerType === "user" ? "user" : "character",
    ownerId,
    weekStart,
    summary,
    createdAt: typeof record.createdAt === "string" ? record.createdAt : now,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : now,
  };
}

function loadStore(): PersistedStore {
  if (typeof window === "undefined") return { reviews: [] };
  try {
    const raw = kvGet(KEY);
    if (!raw) return { reviews: [] };
    const parsed = JSON.parse(raw) as Partial<PersistedStore>;
    return {
      reviews: Array.isArray(parsed.reviews)
        ? parsed.reviews.map(normalize).filter((item): item is CalendarWeeklyReview => Boolean(item))
        : [],
    };
  } catch {
    return { reviews: [] };
  }
}

export function loadCalendarWeeklyReviews(ownerType: CalendarOwnerType, ownerId: string): CalendarWeeklyReview[] {
  return loadStore().reviews
    .filter(item => item.ownerType === ownerType && item.ownerId === ownerId)
    .sort((a, b) => b.weekStart.localeCompare(a.weekStart));
}

export function loadCalendarWeeklyReview(
  ownerType: CalendarOwnerType,
  ownerId: string,
  weekStart: string,
): CalendarWeeklyReview | null {
  return loadStore().reviews.find(item =>
    item.ownerType === ownerType && item.ownerId === ownerId && item.weekStart === weekStart
  ) ?? null;
}

export function saveCalendarWeeklyReview(params: {
  ownerType: CalendarOwnerType;
  ownerId: string;
  weekStart: string;
  summary: string;
}): CalendarWeeklyReview {
  const existing = loadCalendarWeeklyReview(params.ownerType, params.ownerId, params.weekStart);
  const now = new Date().toISOString();
  const review: CalendarWeeklyReview = {
    id: existing?.id ?? `calendar_week_review_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    ownerType: params.ownerType,
    ownerId: params.ownerId,
    weekStart: params.weekStart,
    summary: cleanText(params.summary, 1200),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  const store = loadStore();
  kvSet(KEY, JSON.stringify({
    reviews: [...store.reviews.filter(item => item.id !== review.id), review].slice(-80),
  }));
  return review;
}
