"use client";

// components/settings/usage-statistics.tsx
// 用量统计面板：token 消耗日历 + 年度热力图 + 各路由余额。
//
// 数据来源分两条，刻意分开：
//   1. 用量（token 数、调用次数、花费）来自 lib/usage-ledger.ts 的本地账本，
//      按「天 × 路由 × 模型」持久聚合，纯本地、离线可看；
//   2. 余额来自 /api/llm-balance 服务端代理（浏览器直连会被 CORS 拦，且不该把
//      apiKey 撒到第三方网络层）。余额是「此刻的实时值」，不落到账本里 ——
//      历史余额是另一件事，混进来会让「用量」与「余额」两个口径互相污染。

import { useCallback, useEffect, useMemo, useState } from "react";
import {
    AlertCircle, Brain, CalendarDays, ChevronDown, ChevronRight, Coins, Flame,
    RefreshCw, Wallet,
} from "lucide-react";
import {
    listUsageDays, getUsageLedger, summarizeByRoute, summarizeByProvider,
    localDateKey, type DayUsage, type UsageTokens,
} from "@/lib/usage-ledger";
import { loadApiConfigs } from "@/lib/settings-storage";
import { hydrateKvDb } from "@/lib/kv-db";
import type { ApiConfig } from "@/lib/settings-types";
import { determineBaseUrl } from "@/lib/api-helpers";

/** 热力图只画最近一年（GitHub 贡献图的惯例）。 */
const HEATMAP_DAYS = 371;
/** 日历可翻看多少个月。 */
const CALENDAR_MONTHS_BACK = 24;

const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];

type BalanceEntry = {
    total?: number;
    granted?: number;
    toppedUp?: number;
    used?: number;
    currency?: string;
    unit?: string;
};

type BalanceState =
    | { status: "loading" }
    | { status: "ok"; entries: BalanceEntry[]; available?: boolean; note?: string; shape?: string }
    | { status: "error"; error: string };

function formatTokens(n: number): string {
    if (!Number.isFinite(n) || n <= 0) return "0";
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 1 : 2)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1)}K`;
    return String(Math.round(n));
}

function formatMoney(n: number | undefined, currency?: string): string {
    if (n === undefined) return "—";
    const unit = currency === "USD" ? "$" : currency === "CNY" ? "¥" : "";
    const fixed = Math.abs(n) >= 100 ? n.toFixed(1) : n.toFixed(2);
    return unit ? `${unit}${fixed}` : fixed;
}

/** 把总数映射到 0-4 级，交给 CSS 决定配色；用相对分位而不是绝对阈值，避免量级差异导致整图同色。 */
function tokenLevel(value: number, max: number): 0 | 1 | 2 | 3 | 4 {
    if (!value || value <= 0 || max <= 0) return 0;
    const ratio = value / max;
    if (ratio <= 0.25) return 1;
    if (ratio <= 0.5) return 2;
    if (ratio <= 0.75) return 3;
    return 4;
}

/** 本地时区的 Date → YYYY-MM-DD，与账本的键保持一致（不能用 toISOString，那是 UTC）。 */
function dateKey(d: Date): string {
    return localDateKey(d);
}

function lastNDays(n: number): Date[] {
    const out: Date[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = n - 1; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        out.push(d);
    }
    return out;
}

function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
    const d = new Date(year, month + delta, 1);
    return { year: d.getFullYear(), month: d.getMonth() };
}

export function UsageStatistics() {
    const [days, setDays] = useState<DayUsage[]>([]);
    const [configs, setConfigs] = useState<ApiConfig[]>([]);
    const [balances, setBalances] = useState<Record<string, BalanceState>>({});
    const [expandedRoute, setExpandedRoute] = useState<string | null>(null);
    const [selectedDate, setSelectedDate] = useState<string | null>(null);
    const today = new Date();
    const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() });
    const [loaded, setLoaded] = useState(false);

    const reloadLedger = useCallback(() => {
        setDays(listUsageDays());
        setConfigs(loadApiConfigs());
        setLoaded(true);
    }, []);

    useEffect(() => {
        let cancelled = false;
        // 必须先等 kv-db 水合完成再读账本：账本存在 IndexedDB 里，页面刷新后内存缓存是空的，
        // 由 hydrateKvDb() 异步回填。若直接读，会把「还没加载完」误判成「没有数据」，
        // 让用户以为统计丢了。binding-manager 同样是先 await 再渲染。
        void (async () => {
            await hydrateKvDb().catch(() => { /* 水合失败也要继续，读到的就是当前缓存内容 */ });
            if (cancelled) return;
            reloadLedger();
        })();
        // 账本在别的页面也会被写入（聊天时），切回本面板时重新读一次即可，
        // 不订阅全局事件是为了避免为一个统计面板引入跨模块耦合。
        const onFocus = () => reloadLedger();
        window.addEventListener("focus", onFocus);
        return () => {
            cancelled = true;
            window.removeEventListener("focus", onFocus);
        };
    }, [reloadLedger]);

    const byDate = useMemo(() => {
        const map = new Map<string, DayUsage>();
        for (const d of days) map.set(d.date, d);
        return map;
    }, [days]);

    const maxDayTotal = useMemo(
        () => days.reduce((m, d) => Math.max(m, d.totals.total), 0),
        [days],
    );

    const totals = useMemo<UsageTokens & { cost?: number }>(() => {
        const acc: UsageTokens & { cost?: number } = { prompt: 0, completion: 0, total: 0, calls: 0 };
        for (const d of days) {
            acc.prompt += d.totals.prompt;
            acc.completion += d.totals.completion;
            acc.total += d.totals.total;
            acc.calls += d.totals.calls;
            if (d.cost !== undefined) acc.cost = (acc.cost ?? 0) + d.cost;
        }
        return acc;
    }, [days]);

    const routeSummaries = useMemo(() => summarizeByRoute(), [days]);
    const providerSummaries = useMemo(() => summarizeByProvider(), [days]);

    const heatmapGrid = useMemo(() => {
        const grid = lastNDays(HEATMAP_DAYS);
        // 按周对齐：整体偏移到周日开头，列 = 周
        const firstWeekday = grid[0].getDay();
        const padded: Array<Date | null> = [...Array(firstWeekday).fill(null), ...grid];
        const weeks: Array<Array<Date | null>> = [];
        for (let i = 0; i < padded.length; i += 7) weeks.push(padded.slice(i, i + 7));
        return weeks;
    }, []);

    const monthCells = useMemo(() => {
        const first = new Date(cursor.year, cursor.month, 1);
        const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();
        const lead = first.getDay();
        const cells: Array<Date | null> = [...Array(lead).fill(null)];
        for (let i = 1; i <= daysInMonth; i++) cells.push(new Date(cursor.year, cursor.month, i));
        while (cells.length % 7 !== 0) cells.push(null);
        return cells;
    }, [cursor]);

    const selected = selectedDate ? byDate.get(selectedDate) ?? null : null;

    const oldestMonthIndex = useMemo(() => {
        const d = new Date(today.getFullYear(), today.getMonth() - (CALENDAR_MONTHS_BACK - 1), 1);
        return d.getFullYear() * 12 + d.getMonth();
    }, [today]);
    const currentMonthIndex = cursor.year * 12 + cursor.month;

    const queryBalance = useCallback(async (config: ApiConfig) => {
        setBalances(prev => ({ ...prev, [config.id]: { status: "loading" } }));
        try {
            const baseUrl = determineBaseUrl(config);
            if (!config.apiKey) {
                setBalances(prev => ({ ...prev, [config.id]: { status: "error", error: "未填写 API Key" } }));
                return;
            }
            if (!baseUrl) {
                setBalances(prev => ({ ...prev, [config.id]: { status: "error", error: "缺少 Base URL，无法定位余额接口" } }));
                return;
            }
            const res = await fetch("/api/llm-balance", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ baseUrl, apiKey: config.apiKey, provider: config.provider }),
            });
            const json = await res.json().catch(() => null) as
                | { ok?: boolean; entries?: BalanceEntry[]; available?: boolean; error?: string; note?: string; shape?: string }
                | null;
            if (!json?.ok) {
                setBalances(prev => ({ ...prev, [config.id]: { status: "error", error: json?.error || `HTTP ${res.status}` } }));
                return;
            }
            setBalances(prev => ({
                ...prev,
                [config.id]: { status: "ok", entries: json.entries ?? [], available: json.available, note: json.note, shape: json.shape },
            }));
        } catch (err) {
            setBalances(prev => ({
                ...prev,
                [config.id]: { status: "error", error: err instanceof Error ? err.message : String(err) },
            }));
        }
    }, []);

    const queryAll = useCallback(() => {
        for (const c of configs) void queryBalance(c);
    }, [configs, queryBalance]);

    if (!loaded) return null;

    const hasData = days.length > 0;

    return (
        <div className="flex flex-col gap-6 pb-20">
            <div className="flex items-center justify-between gap-2">
                <h2 className="m-0 mx-2 ts-28 font-bold italic leading-none text-black">Usage</h2>
                <button
                    type="button"
                    onClick={reloadLedger}
                    className="ui-btn rounded-[20px] mr-2"
                    title="重新读取本地账本"
                >
                    <RefreshCw size={14} /> 刷新
                </button>
            </div>

            {/* ── 总览 ── */}
            <div className="grid grid-cols-2 gap-3 px-2">
                <StatTile icon={<Brain size={16} />} label="总 Token" value={formatTokens(totals.total)} />
                <StatTile icon={<Flame size={16} />} label="调用次数" value={String(totals.calls)} />
                <StatTile icon={<Coins size={16} />} label="估算花费" value={formatMoney(totals.cost, "CNY")} hint={totals.cost === undefined ? "未配置单价" : undefined} />
                <StatTile icon={<CalendarDays size={16} />} label="有记录天数" value={String(days.length)} />
            </div>
            <div className="px-4 ts-12" style={{ color: "var(--c-icon)" }}>
                输入 {formatTokens(totals.prompt)} · 输出 {formatTokens(totals.completion)}
                {totals.cost === undefined && " · 花费需在「API 设置」里为模型填写单价后才会计价"}
            </div>

            {!hasData && (
                <div className="ui-empty mx-2">
                    <div className="ui-icon-circle"><AlertCircle size={24} /></div>
                    <span className="menu-label font-semibold">还没有用量记录</span>
                    <span className="menu-desc max-w-[260px]">
                        账本从本次更新后开始记录。发起几次对话或后台总结后回到这里即可看到统计。
                    </span>
                </div>
            )}

            {/* ── 年度热力图 ── */}
            {hasData && (
                <section className="mx-2">
                    <SectionTitle icon={<Flame size={15} />} title="近一年消耗热力图" />
                    <div className="ui-list-card-expandable p-3">
                        <div className="flex gap-[3px] overflow-x-auto pb-1">
                            {heatmapGrid.map((week, wi) => (
                                <div key={wi} className="flex flex-col gap-[3px]">
                                    {week.map((day, di) => {
                                        if (!day) return <div key={di} style={{ width: 11, height: 11 }} />;
                                        const key = dateKey(day);
                                        const rec = byDate.get(key);
                                        const level = tokenLevel(rec?.totals.total ?? 0, maxDayTotal);
                                        return (
                                            <button
                                                key={di}
                                                type="button"
                                                title={`${key} · ${formatTokens(rec?.totals.total ?? 0)} tokens · ${rec?.totals.calls ?? 0} 次`}
                                                onClick={() => setSelectedDate(key)}
                                                className="rounded-[2px]"
                                                style={{
                                                    width: 11,
                                                    height: 11,
                                                    border: "none",
                                                    cursor: "pointer",
                                                    background: level === 0
                                                        ? "var(--c-panel-border)"
                                                        : `color-mix(in srgb, var(--c-icon-teal, #2dd4bf) ${level * 22 + 12}%, transparent)`,
                                                }}
                                            />
                                        );
                                    })}
                                </div>
                            ))}
                        </div>
                        <div className="flex items-center justify-end gap-1 mt-2 ts-12" style={{ color: "var(--c-icon)" }}>
                            <span>少</span>
                            {[0, 1, 2, 3, 4].map(l => (
                                <span
                                    key={l}
                                    className="rounded-[2px]"
                                    style={{
                                        width: 10, height: 10, display: "inline-block",
                                        background: l === 0
                                            ? "var(--c-panel-border)"
                                            : `color-mix(in srgb, var(--c-icon-teal, #2dd4bf) ${l * 22 + 12}%, transparent)`,
                                    }}
                                />
                            ))}
                            <span>多</span>
                        </div>
                    </div>
                </section>
            )}

            {/* ── 月历 ── */}
            {hasData && (
                <section className="mx-2">
                    <div className="flex items-center justify-between mb-2">
                        <SectionTitle icon={<CalendarDays size={15} />} title={`${cursor.year} 年 ${cursor.month + 1} 月`} />
                        <div className="flex items-center gap-1">
                            <button
                                type="button"
                                className="ui-btn rounded-[16px] px-2"
                                disabled={currentMonthIndex <= oldestMonthIndex}
                                onClick={() => setCursor(c => shiftMonth(c.year, c.month, -1))}
                            >‹</button>
                            <button
                                type="button"
                                className="ui-btn rounded-[16px] px-2"
                                disabled={currentMonthIndex >= today.getFullYear() * 12 + today.getMonth()}
                                onClick={() => setCursor(c => shiftMonth(c.year, c.month, 1))}
                            >›</button>
                        </div>
                    </div>
                    <div className="ui-list-card-expandable p-3">
                        <div className="grid grid-cols-7 gap-[3px] mb-1">
                            {WEEKDAY_LABELS.map(w => (
                                <div key={w} className="ts-12 text-center" style={{ color: "var(--c-icon)" }}>{w}</div>
                            ))}
                        </div>
                        <div className="grid grid-cols-7 gap-[3px]">
                            {monthCells.map((day, i) => {
                                if (!day) return <div key={i} />;
                                const key = dateKey(day);
                                const rec = byDate.get(key);
                                const level = tokenLevel(rec?.totals.total ?? 0, maxDayTotal);
                                const isToday = key === dateKey(new Date());
                                return (
                                    <button
                                        key={i}
                                        type="button"
                                        onClick={() => setSelectedDate(key)}
                                        className="rounded-[4px] flex flex-col items-center justify-center"
                                        style={{
                                            height: 34,
                                            border: isToday ? "1px solid var(--c-icon)" : "1px solid transparent",
                                            cursor: "pointer",
                                            background: level === 0
                                                ? "var(--c-card)"
                                                : `color-mix(in srgb, var(--c-icon-teal, #2dd4bf) ${level * 22 + 12}%, transparent)`,
                                        }}
                                        title={`${key} · ${formatTokens(rec?.totals.total ?? 0)} tokens`}
                                    >
                                        <span className="ts-12" style={{ color: "var(--c-text)" }}>{day.getDate()}</span>
                                        {rec && rec.totals.total > 0 && (
                                            <span className="ts-12" style={{ fontSize: 9, color: "var(--c-icon)" }}>
                                                {formatTokens(rec.totals.total)}
                                            </span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </section>
            )}

            {/* ── 某一天的明细 ── */}
            {selectedDate && (
                <section className="mx-2">
                    <SectionTitle icon={<CalendarDays size={15} />} title={`${selectedDate} 明细`} />
                    <div className="ui-list-card-expandable p-3">
                        {!selected ? (
                            <div className="ts-13" style={{ color: "var(--c-icon)" }}>这一天没有调用记录。</div>
                        ) : (
                            <div className="flex flex-col gap-2">
                                <div className="ts-13" style={{ color: "var(--c-text)" }}>
                                    共 {formatTokens(selected.totals.total)} tokens · {selected.totals.calls} 次调用
                                    {selected.cost !== undefined && ` · 约 ${formatMoney(selected.cost, "CNY")}`}
                                </div>
                                {Object.entries(selected.routes).map(([routeId, route]) => (
                                    <div key={routeId} className="flex flex-col gap-1 pt-2" style={{ borderTop: "1px solid var(--c-panel-border)" }}>
                                        <div className="flex items-center justify-between">
                                            <span className="ts-13 font-medium" style={{ color: "var(--c-text)" }}>{route.label}</span>
                                            <span className="ts-12" style={{ color: "var(--c-icon)" }}>
                                                {formatTokens(route.total)} · {route.calls} 次
                                            </span>
                                        </div>
                                        {Object.entries(route.models).map(([model, mu]) => (
                                            <div key={model} className="flex items-center justify-between ts-12" style={{ color: "var(--c-icon)" }}>
                                                <span className="truncate" style={{ maxWidth: "62%" }}>{model}</span>
                                                <span>
                                                    {formatTokens(mu.total)}
                                                    {mu.cost !== undefined ? ` · ${formatMoney(mu.cost, "CNY")}` : " · 未计价"}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </section>
            )}

            {/* ── 各路由用量 ── */}
            {routeSummaries.length > 0 && (
                <section className="mx-2">
                    <SectionTitle icon={<Brain size={15} />} title="各路由消耗" />
                    <div className="flex flex-col gap-2">
                        {routeSummaries.map(route => {
                            const routeId = route.routeId;
                            const expanded = expandedRoute === routeId;
                            return (
                                <div key={routeId} className="ui-list-card-expandable">
                                    <button
                                        type="button"
                                        className="w-full flex items-center justify-between gap-2 p-3"
                                        style={{ background: "none", border: "none", cursor: "pointer" }}
                                        onClick={() => setExpandedRoute(expanded ? null : routeId)}
                                    >
                                        <span className="flex items-center gap-2 min-w-0">
                                            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                            <span className="truncate ts-14 font-medium" style={{ color: "var(--c-text)" }}>{route.label}</span>
                                            <span className="ui-badge shrink-0" data-variant="muted">{route.provider}</span>
                                        </span>
                                        <span className="ts-12 shrink-0" style={{ color: "var(--c-icon)" }}>
                                            {formatTokens(route.total)} · {route.calls} 次
                                            {route.cost !== undefined && ` · ${formatMoney(route.cost, "CNY")}`}
                                        </span>
                                    </button>
                                    {expanded && (
                                        <div className="px-3 pb-3 flex flex-col gap-1">
                                            {Object.entries(route.models).map(([model, mu]) => (
                                                <div key={model} className="flex items-center justify-between ts-12" style={{ color: "var(--c-icon)" }}>
                                                    <span className="truncate" style={{ maxWidth: "58%" }}>{model}</span>
                                                    <span>
                                                        入 {formatTokens(mu.prompt)} · 出 {formatTokens(mu.completion)}
                                                        {mu.cost !== undefined ? ` · ${formatMoney(mu.cost, "CNY")}` : " · 未计价"}
                                                    </span>
                                                </div>
                                            ))}
                                            <div className="ts-12 pt-1" style={{ color: "var(--c-icon)" }}>
                                                来源：
                                                {Object.entries(route.bySource).map(([src, n]) => (
                                                    <span key={src}> {src === "chat" ? "聊天" : src === "background" ? "后台" : "工坊"} {n} 次</span>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </section>
            )}

            {/* ── 按厂商汇总 ── */}
            {providerSummaries.length > 1 && (
                <section className="mx-2">
                    <SectionTitle icon={<Wallet size={15} />} title="按厂商汇总" />
                    <div className="ui-list-card-expandable p-3 flex flex-col gap-1">
                        {providerSummaries.map(p => (
                            <div key={p.provider} className="flex items-center justify-between ts-13">
                                <span style={{ color: "var(--c-text)" }}>{p.provider}</span>
                                <span style={{ color: "var(--c-icon)" }}>
                                    {formatTokens(p.total)} · {p.calls} 次
                                    {p.cost !== undefined && ` · ${formatMoney(p.cost, "CNY")}`}
                                </span>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {/* ── 各路由余额 ── */}
            <section className="mx-2">
                <div className="flex items-center justify-between mb-2">
                    <SectionTitle icon={<Wallet size={15} />} title="各路由余额" />
                    <button
                        type="button"
                        onClick={queryAll}
                        className="ui-btn rounded-[16px] px-3"
                        disabled={configs.length === 0}
                    >
                        <RefreshCw size={13} /> 全部查询
                    </button>
                </div>

                {configs.length === 0 ? (
                    <div className="ui-list-card-expandable p-3 ts-13" style={{ color: "var(--c-icon)" }}>
                        还没有 API 配置。到「API 设置」添加后即可在这里查询余额。
                    </div>
                ) : (
                    <div className="flex flex-col gap-2">
                        {configs.map(config => {
                            const state = balances[config.id];
                            return (
                                <div key={config.id} className="ui-list-card-expandable p-3 flex flex-col gap-2">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="flex items-center gap-2 min-w-0">
                                            <span className="truncate ts-14 font-medium" style={{ color: "var(--c-text)" }}>
                                                {config.name || config.provider}
                                            </span>
                                            <span className="ui-badge shrink-0" data-variant="muted">{config.provider}</span>
                                        </span>
                                        <button
                                            type="button"
                                            className="ui-btn rounded-[16px] px-3 shrink-0"
                                            onClick={() => void queryBalance(config)}
                                            disabled={state?.status === "loading"}
                                        >
                                            {state?.status === "loading" ? "查询中…" : "查询"}
                                        </button>
                                    </div>

                                    {state?.status === "error" && (
                                        <div className="ts-12" style={{ color: "var(--c-danger, #f87171)" }}>
                                            查询失败：{state.error}
                                        </div>
                                    )}
                                    {state?.status === "ok" && (
                                        <div className="flex flex-col gap-1">
                                            {state.entries.length === 0 && (
                                                <div className="ts-12" style={{ color: "var(--c-icon)" }}>接口返回了空余额列表。</div>
                                            )}
                                            {state.entries.map((e, i) => (
                                                <div key={i} className="flex items-center justify-between ts-13">
                                                    <span style={{ color: "var(--c-icon)" }}>
                                                        可用余额{e.currency ? ` (${e.currency})` : ""}
                                                        {e.unit ? ` · ${e.unit}` : ""}
                                                    </span>
                                                    <span className="font-medium" style={{ color: "var(--c-text)" }}>
                                                        {formatMoney(e.total, e.currency)}
                                                    </span>
                                                </div>
                                            ))}
                                            {state.entries[0]?.granted !== undefined && (
                                                <div className="flex items-center justify-between ts-12" style={{ color: "var(--c-icon)" }}>
                                                    <span>其中赠金</span>
                                                    <span>{formatMoney(state.entries[0].granted, state.entries[0].currency)}</span>
                                                </div>
                                            )}
                                            {state.entries[0]?.toppedUp !== undefined && (
                                                <div className="flex items-center justify-between ts-12" style={{ color: "var(--c-icon)" }}>
                                                    <span>其中充值</span>
                                                    <span>{formatMoney(state.entries[0].toppedUp, state.entries[0].currency)}</span>
                                                </div>
                                            )}
                                            {state.entries[0]?.used !== undefined && (
                                                <div className="flex items-center justify-between ts-12" style={{ color: "var(--c-icon)" }}>
                                                    <span>已用</span>
                                                    <span>{formatMoney(state.entries[0].used, state.entries[0].currency)}</span>
                                                </div>
                                            )}
                                            {state.available === false && (
                                                <div className="ts-12" style={{ color: "var(--c-danger, #f87171)" }}>
                                                    账号余额已不足以继续调用。
                                                </div>
                                            )}
                                            {state.note && (
                                                <div className="ts-12" style={{ color: "var(--c-icon)" }}>{state.note}</div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
                <div className="ts-12 mt-2 px-1" style={{ color: "var(--c-icon)" }}>
                    余额由服务端代理查询（浏览器直连会被跨域拦住）。中转站若只返回站内额度单位，
                    这里会标注「未换算为货币」，不会拿一个猜测的汇率换算出一个看似精确的数字。
                </div>
            </section>
        </div>
    );
}

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
    return (
        <h3 className="settings-menu-section-title flex items-center gap-2">
            {icon}
            {title}
        </h3>
    );
}

function StatTile({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint?: string }) {
    return (
        <div className="ui-config-card items-start gap-1" style={{ padding: 12 }}>
            <span className="flex items-center gap-2 ts-12" style={{ color: "var(--c-icon)" }}>
                {icon}
                {label}
            </span>
            <span className="ts-20 font-bold" style={{ color: "var(--c-text)" }}>{value}</span>
            {hint && <span className="ts-12" style={{ color: "var(--c-icon)" }}>{hint}</span>}
        </div>
    );
}
