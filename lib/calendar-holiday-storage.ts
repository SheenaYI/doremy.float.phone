import { kvGet, kvSet, registerKvMigration } from "./kv-db";

export type CalendarHolidayCountry = {
  code: string;
  label: string;
};

export const CALENDAR_HOLIDAY_COUNTRIES: CalendarHolidayCountry[] = [
  { code: "CN", label: "中国" },
  { code: "US", label: "美国" },
  { code: "JP", label: "日本" },
  { code: "GB", label: "英国" },
  { code: "CA", label: "加拿大" },
  { code: "AU", label: "澳大利亚" },
  { code: "DE", label: "德国" },
  { code: "FR", label: "法国" },
  { code: "KR", label: "韩国" },
  { code: "SG", label: "新加坡" },
];

export type CalendarHolidayConfig = {
  enabled: boolean;
  /** 国家代码，如 CN / US */
  countries: string[];
};

export const DEFAULT_CALENDAR_HOLIDAY_CONFIG: CalendarHolidayConfig = {
  enabled: false,
  countries: ["CN"],
};

type HolidayCacheEntry = {
  fetchedAt: number;
  days: Record<string, string[]>;
};

type HolidayCacheStore = {
  entries: Record<string, HolidayCacheEntry>;
};

const CONFIG_KEY = "ai_phone_calendar_holiday_config_v1";
const CACHE_KEY = "ai_phone_calendar_holiday_cache_v1";
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;
registerKvMigration(CONFIG_KEY);
registerKvMigration(CACHE_KEY);

const inFlight = new Map<string, Promise<Record<string, string[]>>>();

function cleanText(value: unknown, maxLength: number): string {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, maxLength);
}

function countryLabel(code: string): string {
  return CALENDAR_HOLIDAY_COUNTRIES.find(item => item.code === code)?.label ?? code;
}

export function loadCalendarHolidayConfig(): CalendarHolidayConfig {
  if (typeof window === "undefined") return DEFAULT_CALENDAR_HOLIDAY_CONFIG;
  try {
    const raw = kvGet(CONFIG_KEY);
    if (!raw) return DEFAULT_CALENDAR_HOLIDAY_CONFIG;
    const parsed = JSON.parse(raw) as Partial<CalendarHolidayConfig>;
    const allowed = new Set(CALENDAR_HOLIDAY_COUNTRIES.map(item => item.code));
    const countries = Array.isArray(parsed.countries)
      ? Array.from(new Set(parsed.countries.map(item => cleanText(item, 4)).filter(code => allowed.has(code))))
      : DEFAULT_CALENDAR_HOLIDAY_CONFIG.countries;
    return {
      enabled: parsed.enabled === true,
      countries: countries.length > 0 ? countries : DEFAULT_CALENDAR_HOLIDAY_CONFIG.countries,
    };
  } catch {
    return DEFAULT_CALENDAR_HOLIDAY_CONFIG;
  }
}

export function saveCalendarHolidayConfig(config: CalendarHolidayConfig): CalendarHolidayConfig {
  if (typeof window === "undefined") return config;
  const allowed = new Set(CALENDAR_HOLIDAY_COUNTRIES.map(item => item.code));
  const normalized: CalendarHolidayConfig = {
    enabled: config.enabled === true,
    countries: Array.from(new Set(config.countries.filter(code => allowed.has(code)))).slice(0, 10),
  };
  kvSet(CONFIG_KEY, JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent("calendar-holiday-updated"));
  return normalized;
}

function loadCacheStore(): HolidayCacheStore {
  if (typeof window === "undefined") return { entries: {} };
  try {
    const raw = kvGet(CACHE_KEY);
    if (!raw) return { entries: {} };
    const parsed = JSON.parse(raw) as Partial<HolidayCacheStore>;
    return { entries: parsed.entries && typeof parsed.entries === "object" ? parsed.entries : {} };
  } catch {
    return { entries: {} };
  }
}

function saveCacheStore(store: HolidayCacheStore): void {
  if (typeof window === "undefined") return;
  kvSet(CACHE_KEY, JSON.stringify(store));
}

function cacheKey(country: string, year: number): string {
  // v2: 中国区改用 holiday-cn 的放假区间，旧缓存（只有单日）必须失效。
  return `v3:${country}:${year}`;
}

async function fetchChinaHolidayYear(year: number): Promise<Record<string, string[]>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/${year}.json`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return {};
    const data = await response.json() as { days?: Array<{ name?: string; date?: string; isOffDay?: boolean }> };
    const days: Record<string, string[]> = {};
    for (const item of data.days ?? []) {
      if (item.isOffDay !== true) continue;
      const date = cleanText(item.date, 10);
      const name = cleanText(item.name, 24);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !name) continue;
      days[date] = Array.from(new Set([...(days[date] ?? []), name])).slice(0, 4);
    }
    return days;
  } catch {
    return {};
  } finally {
    clearTimeout(timer);
  }
}

async function fetchHolidayYear(country: string, year: number): Promise<Record<string, string[]>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/${country}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return {};
    const data = await response.json() as Array<{ date?: string; localName?: string; name?: string }>;
    if (!Array.isArray(data)) return {};
    const days: Record<string, string[]> = {};
    for (const item of data) {
      const date = cleanText(item.date, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const name = cleanText(item.localName || item.name, 24);
      if (!name) continue;
      const label = `${countryLabel(country)}·${name}`;
      days[date] = Array.from(new Set([...(days[date] ?? []), label])).slice(0, 4);
    }
    return days;
  } catch {
    return {};
  } finally {
    clearTimeout(timer);
  }
}

async function loadCountryYear(country: string, year: number, force = false): Promise<Record<string, string[]>> {
  const key = cacheKey(country, year);
  const store = loadCacheStore();
  const cached = store.entries[key];
  if (!force && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.days;
  const existing = inFlight.get(key);
  if (existing) return existing;
  const task = (async () => {
    const days = country === "CN"
      ? await fetchChinaHolidayYear(year)
      : await fetchHolidayYear(country, year);
    if (Object.keys(days).length > 0) {
      const latest = loadCacheStore();
      latest.entries[key] = { fetchedAt: Date.now(), days };
      saveCacheStore(latest);
    }
    return days;
  })().finally(() => inFlight.delete(key));
  inFlight.set(key, task);
  return task;
}

/** 拉取多个国家、多个年份的节假日，返回 date -> labels。失败/断网时返回已有缓存。 */
export async function loadCalendarHolidayMarks(
  countries: string[],
  years: number[],
  force = false,
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  const uniqueCountries = Array.from(new Set(countries));
  const uniqueYears = Array.from(new Set(years));
  const results = await Promise.all(
    uniqueCountries.flatMap(country => uniqueYears.map(year => loadCountryYear(country, year, force))),
  );
  for (const days of results) {
    for (const [date, labels] of Object.entries(days)) {
      map.set(date, Array.from(new Set([...(map.get(date) ?? []), ...labels])).slice(0, 4));
    }
  }
  return map;
}
