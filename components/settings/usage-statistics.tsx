"use client";

// components/settings/usage-statistics.tsx
// 用量统计面板：token 消耗日历 + 月历热力 + 各路由消耗。
//
// 数据全部来自 lib/usage-ledger.ts 的本地账本（按「天 × 路由 × 模型 × 来源」聚合），
// 纯本地、离线可看。
//
// 刻意不提供余额查询：只剩 DeepSeek 官方与 OpenRouter 的余额接口接受普通 API Key，
// one-api/new-api 系的 /api/user/self 需要另一种令牌（用 sk- key 必然 401/404），
// 而私有中转站多数根本没有余额接口。为少数站点做一套猜测式探测，换来的是
// 「多数请求打不通 + API Key 多经过一跳服务端」的风险，不划算。

import { useCallback, useEffect, useMemo, useState } from "react";
import {
    AlertCircle, Brain, CalendarDays, ChartColumn, ChevronDown, ChevronRight, Coins, RefreshCw,
} from "lucide-react";
import {
    listUsageDays, summarizeByRoute, summarizeByProvider, summarizeByBaseUrl,
    localDateKey, type DayUsage, type UsageTokens, type CostByMode,
} from "@/lib/usage-ledger";
import { hydrateKvDb } from "@/lib/kv-db";

/** 日历可翻看多少个月。 */
const CALENDAR_MONTHS_BACK = 24;

const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];

function formatTokens(n: number): string {
    if (!Number.isFinite(n) || n <= 0) return "0";
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 1 : 2)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1)}K`;
    return String(Math.round(n));
}

function formatMoney(n: number): string {
    return `¥${Math.abs(n) >= 100 ? n.toFixed(1) : n.toFixed(2)}`;
}

/**
 * 把成本按计费方式渲染成文本。
 *
 * 按 token 与按次的金额刻意分开列出、绝不相加：两者是不同口径的量，
 * 求和会得出一个没有意义的数字。未计价的调用数单独提示，让用户知道
 * 这个花费是不完整的，而不是误以为「就花了这么多」。
 */
function formatCost(cost: CostByMode | undefined, unpricedCalls?: number): string | null {
    const parts: string[] = [];
    if (cost?.perToken !== undefined) parts.push(`${formatMoney(cost.perToken)} (token)`);
    if (cost?.perCall !== undefined) parts.push(`${formatMoney(cost.perCall)} (按次)`);
    if (unpricedCalls) parts.push(`${unpricedCalls} 次未计价`);
    return parts.length > 0 ? parts.join(" · ") : null;
}

/** 把用量映射到 0-4 级，交给 CSS 决定配色；用相对分位而非绝对阈值，避免量级差异导致整图同色。 */
function tokenLevel(value: number, max: number): 0 | 1 | 2 | 3 | 4 {
    if (!value || value <= 0 || max <= 0) return 0;
    const ratio = value / max;
    if (ratio <= 0.25) return 1;
    if (ratio <= 0.5) return 2;
    if (ratio <= 0.75) return 3;
    return 4;
}

/** 热力格背景色：4 级绿色。0 级用面板边框色表示「无记录」。 */
function heatBackground(level: 0 | 1 | 2 | 3 | 4): string {
    if (level === 0) return "var(--c-panel-border)";
    return `color-mix(in srgb, var(--c-icon-green, #18A957) ${level * 20 + 15}%, transparent)`;
}

function dateKey(d: Date): string {
    return localDateKey(d);
}

function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
    const d = new Date(year, month + delta, 1);
    return { year: d.getFullYear(), month: d.getMonth() };
}

export function UsageStatistics() {
    const [days, setDays] = useState<DayUsage[]>([]);
    const [expandedRoute, setExpandedRoute] = useState<string | null>(null);
    const [selectedDate, setSelectedDate] = useState<string | null>(null);
    const today = useMemo(() => new Date(), []);
    const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() });
    const [loaded, setLoaded] = useState(false);

    const reloadLedger = useCallback(() => {
        setDays(listUsageDays());
        setLoaded(true);
    }, []);

    useEffect(() => {
        let cancelled = false;
        // 必须先等 kv-db 水合完成再读账本：账本存在 IndexedDB 里，页面刷新后内存缓存是空的，
        // 由 hydrateKvDb() 异步回填。若直接读，会把「还没加载完」误判成「没有数据」。
        void (async () => {
            await hydrateKvDb().catch(() => { /* 水合失败就按当前缓存读 */ });
            if (cancelled) return;
            reloadLedger();
        })();
        return () => { cancelled = true; };
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

    const totals = useMemo<UsageTokens & { cost?: CostByMode; unpricedCalls?: number }>(() => {
        const acc: UsageTokens & { cost?: CostByMode; unpricedCalls?: number } = { prompt: 0, completion: 0, total: 0, calls: 0 };
        const perToken: number[] = [];
        const perCall: number[] = [];
        let unpriced = 0;
        for (const d of days) {
            acc.prompt += d.totals.prompt;
            acc.completion += d.totals.completion;
            acc.total += d.totals.total;
            acc.calls += d.totals.calls;
            if (d.cost?.perToken !== undefined) perToken.push(d.cost.perToken);
            if (d.cost?.perCall !== undefined) perCall.push(d.cost.perCall);
            unpriced += d.unpricedCalls ?? 0;
        }
        const cost: CostByMode = {};
        if (perToken.length > 0) cost.perToken = perToken.reduce((a, b) => a + b, 0);
        if (perCall.length > 0) cost.perCall = perCall.reduce((a, b) => a + b, 0);
        if (Object.keys(cost).length > 0) acc.cost = cost;
        if (unpriced > 0) acc.unpricedCalls = unpriced;
        return acc;
    }, [days]);

    const routeSummaries = useMemo(() => summarizeByRoute(), [days]);
    const providerSummaries = useMemo(() => summarizeByProvider(), [days]);
    const baseUrlSummaries = useMemo(() => summarizeByBaseUrl(), [days]);

    const monthCells = useMemo(() => {
        const first = new Date(cursor.year, cursor.month, 1);
        const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();
        const cells: Array<Date | null> = [...Array(first.getDay()).fill(null)];
        for (let i = 1; i <= daysInMonth; i++) cells.push(new Date(cursor.year, cursor.month, i));
        while (cells.length % 7 !== 0) cells.push(null);
        return cells;
    }, [cursor]);

    /** 月历下方的迷你趋势：本月每日总量的柱状条，一眼看出哪天密集。 */
    const monthDailyTotals = useMemo(() => {
        const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();
        const out: Array<{ day: number; total: number }> = [];
        for (let i = 1; i <= daysInMonth; i++) {
            const key = dateKey(new Date(cursor.year, cursor.month, i));
            out.push({ day: i, total: byDate.get(key)?.totals.total ?? 0 });
        }
        return out;
    }, [cursor, byDate]);

    const selected = selectedDate ? byDate.get(selectedDate) ?? null : null;

    const oldestMonthIndex = useMemo(
        () => new Date(today.getFullYear(), today.getMonth() - (CALENDAR_MONTHS_BACK - 1), 1).getFullYear() * 12
            + new Date(today.getFullYear(), today.getMonth() - (CALENDAR_MONTHS_BACK - 1), 1).getMonth(),
        [today],
    );
    const currentMonthIndex = cursor.year * 12 + cursor.month;

    if (!loaded) return null;

    const hasData = days.length > 0;
    const maxMonthly = monthDailyTotals.reduce((m, d) => Math.max(m, d.total), 0);

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

            {/* ── 总览：纯色卡片，承载最关键的四个数字 ── */}
            <div className="grid grid-cols-2 gap-3 px-2">
                <StatTile icon={<Brain size={16} />} label="总 Token" value={formatTokens(totals.total)} />
                <StatTile icon={<ChartColumn size={16} />} label="调用次数" value={String(totals.calls)} />
                <StatTile
                    icon={<Coins size={16} />}
                    label="估算花费"
                    value={formatCost(totals.cost, totals.unpricedCalls) ?? "未计价"}
                    hint={totals.cost === undefined ? "在「API 设置」里为模型填价格" : undefined}
                />
                <StatTile icon={<CalendarDays size={16} />} label="有记录天数" value={String(days.length)} />
            </div>
            <div className="px-4 ts-12" style={{ color: "var(--c-icon)" }}>
                输入 {formatTokens(totals.prompt)} · 输出 {formatTokens(totals.completion)}
                {totals.cost !== undefined && " · 按 token 与按次的金额分开计算，不相加"}
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

            {/* ── 月历热力 + 当月柱状趋势 ── */}
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

                    {/* 磨砂卡片承载网格：与上方纯色统计卡形成质感对比 */}
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
                                            height: 36,
                                            border: isToday ? "1px solid var(--c-icon-green, #18A957)" : "1px solid transparent",
                                            cursor: "pointer",
                                            background: heatBackground(level),
                                        }}
                                        title={`${key} · ${formatTokens(rec?.totals.total ?? 0)} tokens · ${rec?.totals.calls ?? 0} 次`}
                                    >
                                        <span className="ts-12" style={{ color: "var(--c-text)" }}>{day.getDate()}</span>
                                        {rec && rec.totals.total > 0 && (
                                            <span style={{ fontSize: 9, color: "var(--c-icon)" }}>{formatTokens(rec.totals.total)}</span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>

                        {/* 当月每日柱状趋势：柱高按当月峰值归一 */}
                        <div className="flex items-end gap-[2px] mt-3" style={{ height: 40 }}>
                            {monthDailyTotals.map(d => (
                                <div
                                    key={d.day}
                                    className="flex-1 rounded-t-[2px]"
                                    style={{
                                        height: maxMonthly > 0 ? `${Math.max(2, (d.total / maxMonthly) * 100)}%` : 2,
                                        background: d.total > 0 ? "var(--c-icon-green, #18A957)" : "var(--c-panel-border)",
                                        minWidth: 3,
                                    }}
                                    title={`${cursor.month + 1}/${d.day} · ${formatTokens(d.total)} tokens`}
                                />
                            ))}
                        </div>
                        <div className="flex items-center justify-between mt-2 ts-12" style={{ color: "var(--c-icon)" }}>
                            <span>1 日</span>
                            <span className="flex items-center gap-1">
                                <span className="rounded-[2px]" style={{ width: 10, height: 10, background: "var(--c-panel-border)" }} />无记录
                                <span className="rounded-[2px] ml-2" style={{ width: 10, height: 10, background: "var(--c-icon-green, #18A957)" }} />有消耗
                            </span>
                            <span>{new Date(cursor.year, cursor.month + 1, 0).getDate()} 日</span>
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
                                    {selected.cost && ` · ${formatCost(selected.cost, selected.unpricedCalls)}`}
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
                                                <span className="truncate" style={{ maxWidth: "58%" }}>{model}</span>
                                                <span>
                                                    {formatTokens(mu.total)}
                                                    {formatCost(mu.cost, mu.unpricedCalls) ? ` · ${formatCost(mu.cost, mu.unpricedCalls)}` : ""}
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

            {/* ── 各路由消耗 ── */}
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
                                        </span>
                                    </button>
                                    {expanded && (
                                        <div className="px-3 pb-3 flex flex-col gap-1">
                                            {route.baseUrl && (
                                                <div className="ts-12 truncate" style={{ color: "var(--c-icon)" }}>
                                                    入口：{route.baseUrl}
                                                </div>
                                            )}
                                            {formatCost(route.cost, route.unpricedCalls) && (
                                                <div className="ts-12" style={{ color: "var(--c-text)" }}>
                                                    花费：{formatCost(route.cost, route.unpricedCalls)}
                                                </div>
                                            )}
                                            {Object.entries(route.models).map(([model, mu]) => (
                                                <div key={model} className="flex items-center justify-between ts-12" style={{ color: "var(--c-icon)" }}>
                                                    <span className="truncate" style={{ maxWidth: "52%" }}>{model}</span>
                                                    <span>
                                                        入 {formatTokens(mu.prompt)} · 出 {formatTokens(mu.completion)}
                                                        {mu.billingMode === "per_call" ? " · 按次" : ""}
                                                        {formatCost(mu.cost, mu.unpricedCalls) ? ` · ${formatCost(mu.cost, mu.unpricedCalls)}` : ""}
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

            {/* ── 按入口地址（baseUrl）分类：同一 provider 可能有多个中转站 ── */}
            {baseUrlSummaries.length > 1 && (
                <section className="mx-2">
                    <SectionTitle icon={<ChartColumn size={15} />} title="按入口地址消耗" />
                    <div className="ui-list-card-expandable p-3 flex flex-col gap-2">
                        {baseUrlSummaries.map(entry => (
                            <div key={entry.baseUrl} className="flex items-center justify-between gap-2 ts-13">
                                <span className="truncate" style={{ color: "var(--c-text)", maxWidth: "62%" }} title={entry.baseUrl}>
                                    {entry.baseUrl}
                                </span>
                                <span className="shrink-0" style={{ color: "var(--c-icon)" }}>
                                    {formatTokens(entry.total)} · {entry.calls} 次
                                </span>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {/* ── 按厂商汇总 ── */}
            {providerSummaries.length > 1 && (
                <section className="mx-2">
                    <SectionTitle icon={<Brain size={15} />} title="按厂商汇总" />
                    <div className="ui-list-card-expandable p-3 flex flex-col gap-2">
                        {providerSummaries.map(p => (
                            <div key={p.provider} className="flex items-center justify-between gap-2 ts-13">
                                <span style={{ color: "var(--c-text)" }}>{p.provider}</span>
                                <span style={{ color: "var(--c-icon)" }}>
                                    {formatTokens(p.total)} · {p.calls} 次
                                    {formatCost(p.cost, p.unpricedCalls) ? ` · ${formatCost(p.cost, p.unpricedCalls)}` : ""}
                                </span>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            <div className="ts-12 px-3" style={{ color: "var(--c-icon)" }}>
                花费来自你在「API 设置」里为各模型填写的价格；未填价的模型显示为「未计价」，
                与「花费为 0」区分开。按 token 计费与按次计费是两种口径，始终分开显示、不相加。
            </div>
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
            <span className="ts-18 font-bold" style={{ color: "var(--c-text)" }}>{value}</span>
            {hint && <span className="ts-12" style={{ color: "var(--c-icon)" }}>{hint}</span>}
        </div>
    );
}
