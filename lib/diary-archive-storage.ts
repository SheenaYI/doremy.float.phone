import { kvGet, kvSet, registerKvMigration } from "./kv-db";

export type DiaryArchivePosition = {
  x: number;
  y: number;
};

type Store = {
  positions: Record<string, DiaryArchivePosition>;
  covers: Record<string, string>;
};

const KEY = "ai_phone_diary_archive_layout_v1";
registerKvMigration(KEY);

function loadStore(): Store {
  if (typeof window === "undefined") return { positions: {}, covers: {} };
  try {
    const raw = kvGet(KEY);
    if (!raw) return { positions: {}, covers: {} };
    const parsed = JSON.parse(raw) as Partial<Store>;
    return {
      positions: parsed.positions && typeof parsed.positions === "object" ? parsed.positions : {},
      covers: parsed.covers && typeof parsed.covers === "object" ? parsed.covers : {},
    };
  } catch {
    return { positions: {}, covers: {} };
  }
}

export function loadDiaryArchivePositions(): Record<string, DiaryArchivePosition> {
  return loadStore().positions;
}

export function loadDiaryArchiveCovers(): Record<string, string> {
  return loadStore().covers;
}

export function saveDiaryArchiveCover(characterId: string, mediaRef: string): void {
  if (!characterId || typeof window === "undefined") return;
  const store = loadStore();
  store.covers[characterId] = mediaRef;
  kvSet(KEY, JSON.stringify(store));
}

export function saveDiaryArchivePosition(characterId: string, position: DiaryArchivePosition): void {
  if (!characterId || typeof window === "undefined") return;
  const store = loadStore();
  store.positions[characterId] = {
    x: Math.max(0, Math.min(82, Math.round(position.x))),
    y: Math.max(0, Math.min(82, Math.round(position.y))),
  };
  kvSet(KEY, JSON.stringify(store));
}
