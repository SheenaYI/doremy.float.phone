import { kvGet, kvSet, registerKvMigration } from "./kv-db";

export type DiaryReadingPosition = {
  entryId: string;
  page: number;
  total: number;
  updatedAt: string;
};

const KEY = "ai_phone_diary_reading_positions_v1";
registerKvMigration(KEY);

type Store = { positions: Record<string, DiaryReadingPosition> };

function loadStore(): Store {
  if (typeof window === "undefined") return { positions: {} };
  try {
    const raw = kvGet(KEY);
    if (!raw) return { positions: {} };
    const parsed = JSON.parse(raw) as Partial<Store>;
    return { positions: parsed.positions && typeof parsed.positions === "object" ? parsed.positions : {} };
  } catch {
    return { positions: {} };
  }
}

export function loadDiaryReadingPosition(entryId: string): DiaryReadingPosition | null {
  return loadStore().positions[entryId] ?? null;
}

export function saveDiaryReadingPosition(entryId: string, page: number, total: number): void {
  if (typeof window === "undefined" || !entryId) return;
  const store = loadStore();
  store.positions[entryId] = {
    entryId,
    page: Math.max(0, Math.round(page)),
    total: Math.max(1, Math.round(total)),
    updatedAt: new Date().toISOString(),
  };
  kvSet(KEY, JSON.stringify(store));
}
