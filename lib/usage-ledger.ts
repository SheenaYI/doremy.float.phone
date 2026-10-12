// lib/usage-ledger.ts
// 用量账本：按「天 × 路由 × 模型」持久聚合每一次大模型调用的 token 用量。
//
// 为什么不能复用 api-log-store：
//   那份是滚动环（上限 150 条 / 8MB），用途是「回看最近几次调用的请求与响应原文」。
//   它会被后台调用（记忆总结、NPC 生成、剧情等 18 处 simpleLLMCall）迅速挤掉，
//   且不记录「用了哪条 ApiConfig 路由」，因此无法支撑日历 / 热力图这种跨月统计。
//   两者用途不同，这里独立成账本：只存数字聚合，不存任何正文，体积增长可控。
//
// 存储约定：kv-db（IndexedDB），单个 kv 键，值与 data-management/modules.ts 的
// settings 模块共用备份通道 —— 新增键必须同步登记进 PRIMARY_DATA_MODULES，
// 否则该数据会从备份与角色本地数据工具里静默消失。

import { kvGet, kvSet, kvRemove, registerKvMigration } from "./kv-db";
import type { BillingMode, ModelPriceConfig } from "./settings-types";

export const USAGE_LEDGER_KEY = "ai_phone_usage_ledger_v1";

/** 账本结构版本。结构变更时递增，并在读取时走兼容分支。 */
const LEDGER_VERSION = 1;

/** 单日记录上限（按日期键排序后裁掉最旧的），避免历史无限增长。 */
const MAX_DAYS = 800;

export type UsageTokens = {
    /** 输入（提示词）token */
    prompt: number;
    /** 输出（补全）token */
    completion: number;
    /** 总 token；缺失时按 prompt + completion 兜底 */
    total: number;
    /** 成功计费的调用次数 */
    calls: number;
};

/** 一次调用的来源：聊天引擎 / 后台功能 / 工坊答疑 */
export type UsageSource = "chat" | "background" | "qa";

/**
 * 两种计费方式的成本，刻意分开存放。
 *
 * 按次计费的中转站上 token 数不参与计价，所以「按 token 的钱」和「按次的钱」是两套
 * 不同口径的量。把它们加成一个 total 会得到一个没有意义的数字，因此这里始终分开，
 * 由展示层决定怎么呈现（混用时并列显示，而不是求和）。
 */
export type CostByMode = {
    /** 按 token 计费的成本合计（元） */
    perToken?: number;
    /** 按次计费的成本合计（元） */
    perCall?: number;
};

/** 把两组成本相加，任一为空时保留另一组。 */
export function addCost(a: CostByMode | undefined, b: CostByMode | undefined): CostByMode | undefined {
    if (!a) return b;
    if (!b) return a;
    const out: CostByMode = {};
    const perToken = (a.perToken ?? 0) + (b.perToken ?? 0);
    const perCall = (a.perCall ?? 0) + (b.perCall ?? 0);
    if (a.perToken !== undefined || b.perToken !== undefined) out.perToken = perToken;
    if (a.perCall !== undefined || b.perCall !== undefined) out.perCall = perCall;
    return out;
}

/**
 * 单个模型在一天内的用量。
 * 成本只在「用户为该模型配了计费配置」时才有值；没配价的模型成本保持 undefined，
 * 这样「未计价」与「花费为 0」不会混为一谈。
 */
export type ModelUsage = UsageTokens & {
    /** 计费方式（缺省按 token） */
    billingMode?: BillingMode;
    /** 输入单价（元 / 百万 token） */
    inputPricePerM?: number;
    /** 输出单价（元 / 百万 token） */
    outputPricePerM?: number;
    /** 单次价格（元 / 次） */
    pricePerCall?: number;
    /** 估算花费（元），按计费方式分别累计 */
    cost?: CostByMode;
    /** 因为该模型没配价而未能计入花费的调用次数 */
    unpricedCalls?: number;
};

/** 一条路由（= 一条 ApiConfig）在一天内的用量，按模型细分。 */
export type RouteUsage = UsageTokens & {
    /** ApiConfig.name || provider，用于展示 */
    label: string;
    /** ApiConfig.provider，用于按厂商汇总 */
    provider: string;
    /** 该路由的 baseUrl（缺省时用 provider 官方端点），用于按入口分类 */
    baseUrl?: string;
    /** 当天该路由的估算花费合计（元），按计费方式分开 */
    cost?: CostByMode;
    /** 未计价调用次数 */
    unpricedCalls?: number;
    /** 按模型名细分 */
    models: Record<string, ModelUsage>;
    /** 按调用来源细分 */
    bySource: Partial<Record<UsageSource, number>>;
};

/** 一天的账本记录 */
export type DayUsage = {
    /** YYYY-MM-DD（本地时区） */
    date: string;
    totals: UsageTokens;
    /** 当天估算花费合计（元），按计费方式分开 */
    cost?: CostByMode;
    /** 未计价调用次数 */
    unpricedCalls?: number;
    /** 按路由 id 细分 */
    routes: Record<string, RouteUsage>;
};

export type UsageLedger = {
    version: number;
    /** date -> DayUsage */
    days: Record<string, DayUsage>;
    /** 首次记录时间（ISO），用于判断「账本从何时开始有数据」 */
    startedAt?: string;
    /** 最近一次记录时间（ISO） */
    updatedAt?: string;
};

/** 记录一次调用所需的最小信息。 */
export type RecordUsageInput = {
    /** 调用结果里的 usage；缺失则本次不计入（例如请求失败） */
    usage?: UsageLike;
    /** 命中的 ApiConfig；缺失时归入「未标注路由」而不是丢弃 */
    config?: { id?: string; name?: string; provider?: string; defaultModel?: string; baseUrl?: string };
    /** 实际使用的模型名，优先于 config.defaultModel */
    model?: string;
    source?: UsageSource;
    /** 该模型的计费配置，由调用方从用户配置读出 */
    price?: ModelPriceConfig;
    /** 覆盖记录日期（测试用），缺省取当前时间 */
    date?: Date;
};

/**
 * usage 的来源形状。
 *
 * 刻意不写死成 { prompt_tokens?: number ... }：各家适配器（Anthropic 的 input_tokens、
 * Gemini 的 promptTokenCount）会先归一化，归一化后的实际类型比这里更宽。若在此写死窄类型，
 * 调用方把 api-log-store 的 usage 直接传进来就会类型不兼容，逼出无意义的强转。
 * coerceCount 在运行时已经对任意输入做了防御，所以这里只约束「可能存在的字段名」。
 */
type UsageLike = {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    total_tokens?: unknown;
};

function emptyTokens(): UsageTokens {
    return { prompt: 0, completion: 0, total: 0, calls: 0 };
}

function emptyLedger(): UsageLedger {
    return { version: LEDGER_VERSION, days: {} };
}

function _load(): UsageLedger {
    try {
        // 刻意不加 `typeof window !== "undefined"` 守卫（api-log-store 的 _loadLogs 有，
        // 但那是与它自己的 _saveLogs 对称的历史写法）。这里必须与 _save 对称：
        // kv-db 在没有 IndexedDB 的环境里退化为进程内缓存，读写都能正常工作；而只给读加守卫
        // 会造成「写得进去、读不回来」——数据看起来凭空消失，是极难排查的一类 bug。
        const raw = kvGet(USAGE_LEDGER_KEY);
        if (!raw) return emptyLedger();
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return emptyLedger();
        const ledger = parsed as UsageLedger;
        if (!ledger.days || typeof ledger.days !== "object") return emptyLedger();
        return { ...emptyLedger(), ...ledger, days: ledger.days };
    } catch {
        // 账本损坏时退回空账本：统计是附加能力，绝不能因为它挡住调用主流程。
        return emptyLedger();
    }
}

function _save(ledger: UsageLedger): void {
    try {
        kvSet(USAGE_LEDGER_KEY, JSON.stringify(trimLedger(ledger)));
    } catch {
        /* 写入失败不影响调用主流程 */
    }
}

/** 超出天数上限时丢掉最旧的日期记录。 */
function trimLedger(ledger: UsageLedger): UsageLedger {
    const dates = Object.keys(ledger.days);
    if (dates.length <= MAX_DAYS) return ledger;
    const keep = dates.sort().slice(-MAX_DAYS);
    const days: Record<string, DayUsage> = {};
    for (const d of keep) days[d] = ledger.days[d];
    return { ...ledger, days };
}

/** 本地时区的 YYYY-MM-DD。刻意不用 toISOString：那是 UTC，会让「今天」在晚上 8 点后错位。 */
export function localDateKey(d: Date = new Date()): string {
    const y = d.getFullYear();
    const m = `${d.getMonth() + 1}`.padStart(2, "0");
    const day = `${d.getDate()}`.padStart(2, "0");
    return `${y}-${m}-${day}`;
}

function addTokens(target: UsageTokens, prompt: number, completion: number, total: number): void {
    target.prompt += prompt;
    target.completion += completion;
    target.total += total;
    target.calls += 1;
}

/** 由 token 数与单价算花费（元）。单价单位是「元 / 百万 token」。 */
/**
 * 按计费配置算这一次调用的成本。
 *
 * 三种情况必须区分清楚，不能混为一谈：
 *   - 按 token：算 input/output 的加权和；
 *   - 按次：只算 perCall，token 数不参与（中转站按请求次数计费时，token 与价格无关）；
 *   - 没配价：返回 undefined，由调用方计入 unpricedCalls，让「未计价」可见。
 * mode 缺省视为 per_token，兼容只填了 input/output 的历史配置。
 */
function computeCost(prompt: number, completion: number, price?: ModelPriceConfig): CostByMode | undefined {
    if (!price) return undefined;
    const mode: BillingMode = price.mode ?? "per_token";
    if (mode === "per_call") {
        if (price.perCall === undefined) return undefined;
        return { perCall: price.perCall };
    }
    if (price.input === undefined && price.output === undefined) return undefined;
    const inCost = price.input !== undefined ? (prompt / 1_000_000) * price.input : 0;
    const outCost = price.output !== undefined ? (completion / 1_000_000) * price.output : 0;
    return { perToken: inCost + outCost };
}

function coerceCount(v: unknown): number {
    return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
}

/**
 * 记录一次调用的用量。这是账本唯一的写入口。
 *
 * 刻意保持「永不抛出」：统计属于附加能力，任何异常都不该影响大模型调用本身。
 * 没有 usage（请求失败、无返回）时直接返回 null，不产生空记录 —— 否则
 * 失败调用会把「调用次数」这个指标污染成不可信的值。
 */
export function recordUsage(input: RecordUsageInput): DayUsage | null {
    try {
        const raw = input.usage;
        if (!raw) return null;
        const prompt = coerceCount(raw.prompt_tokens);
        const completion = coerceCount(raw.completion_tokens);
        const totalRaw = coerceCount(raw.total_tokens);
        const total = totalRaw > 0 ? totalRaw : prompt + completion;
        // 三项都为 0 说明服务端没给有效 usage，记进去只会污染统计。
        if (prompt === 0 && completion === 0 && total === 0) return null;

        const date = localDateKey(input.date ?? new Date());
        const routeId = input.config?.id || "unlabeled";
        const provider = input.config?.provider || "未标注";
        const label = input.config?.name || input.config?.provider || "未标注路由";
        const model = input.model || input.config?.defaultModel || "未知模型";
        const source: UsageSource = input.source ?? "chat";
        const cost = computeCost(prompt, completion, input.price);

        const ledger = _load();
        const day: DayUsage = ledger.days[date] ?? { date, totals: emptyTokens(), routes: {} };
        const route: RouteUsage = day.routes[routeId] ?? {
            label, provider, ...emptyTokens(), models: {}, bySource: {},
        };
        // 路由显示名、厂商与入口地址以最近一次为准（用户可能改名或换中转站）
        route.label = label;
        route.provider = provider;
        if (input.config?.baseUrl) route.baseUrl = input.config.baseUrl;

        const modelUsage: ModelUsage = route.models[model] ?? { ...emptyTokens() };
        if (input.price) {
            modelUsage.billingMode = input.price.mode ?? "per_token";
            if (input.price.input !== undefined) modelUsage.inputPricePerM = input.price.input;
            if (input.price.output !== undefined) modelUsage.outputPricePerM = input.price.output;
            if (input.price.perCall !== undefined) modelUsage.pricePerCall = input.price.perCall;
        }

        addTokens(modelUsage, prompt, completion, total);
        if (cost !== undefined) {
            modelUsage.cost = addCost(modelUsage.cost, cost);
            route.cost = addCost(route.cost, cost);
            day.cost = addCost(day.cost, cost);
        } else {
            // 没配价的调用单独计数：否则用户看到的总花费会显得「完整」，实际漏了一部分。
            modelUsage.unpricedCalls = (modelUsage.unpricedCalls ?? 0) + 1;
            route.unpricedCalls = (route.unpricedCalls ?? 0) + 1;
            day.unpricedCalls = (day.unpricedCalls ?? 0) + 1;
        }
        route.models[model] = modelUsage;

        addTokens(route, prompt, completion, total);
        route.bySource[source] = (route.bySource[source] ?? 0) + 1;
        day.routes[routeId] = route;

        addTokens(day.totals, prompt, completion, total);
        ledger.days[date] = day;
        ledger.updatedAt = new Date().toISOString();
        if (!ledger.startedAt) ledger.startedAt = ledger.updatedAt;

        _save(ledger);
        return day;
    } catch {
        return null;
    }
}

/** 读取整本账本（已按日期裁到上限内）。 */
export function getUsageLedger(): UsageLedger {
    return _load();
}

/** 读取某一天的记录；没有则返回 null。 */
export function getDayUsage(date: string): DayUsage | null {
    const ledger = _load();
    return ledger.days[date] ?? null;
}

/** 列出日期区间内的记录（含两端），按日期升序。用于日历 / 热力图 / 汇总。 */
export function listUsageDays(from?: string, to?: string): DayUsage[] {
    const ledger = _load();
    return Object.values(ledger.days)
        .filter(d => (!from || d.date >= from) && (!to || d.date <= to))
        .sort((a, b) => a.date.localeCompare(b.date));
}

/** 路由汇总项：带上 routeId，UI 才能用它作稳定 key 与展开状态。 */
export type RouteUsageSummary = RouteUsage & { routeId: string };

/**
 * 把区间内的记录按路由汇总。用于「各路由余额」上方的「各路由消耗」，
 * 以及按 provider 展开的汇总。
 */
export function summarizeByRoute(from?: string, to?: string): RouteUsageSummary[] {
    const acc = new Map<string, RouteUsage>();
    for (const day of listUsageDays(from, to)) {
        for (const [routeId, route] of Object.entries(day.routes)) {
            const target = acc.get(routeId) ?? {
                label: route.label, provider: route.provider, ...emptyTokens(), models: {}, bySource: {},
            };
            target.label = route.label;
            target.provider = route.provider;
            if (route.baseUrl) target.baseUrl = route.baseUrl;
            target.prompt += route.prompt;
            target.completion += route.completion;
            target.total += route.total;
            target.calls += route.calls;
            target.cost = addCost(target.cost, route.cost);
            if (route.unpricedCalls) target.unpricedCalls = (target.unpricedCalls ?? 0) + route.unpricedCalls;
            for (const [model, mu] of Object.entries(route.models)) {
                const t = target.models[model] ?? { ...emptyTokens() };
                t.prompt += mu.prompt;
                t.completion += mu.completion;
                t.total += mu.total;
                t.calls += mu.calls;
                t.cost = addCost(t.cost, mu.cost);
                if (mu.unpricedCalls) t.unpricedCalls = (t.unpricedCalls ?? 0) + mu.unpricedCalls;
                if (mu.billingMode !== undefined) t.billingMode = mu.billingMode;
                if (mu.inputPricePerM !== undefined) t.inputPricePerM = mu.inputPricePerM;
                if (mu.outputPricePerM !== undefined) t.outputPricePerM = mu.outputPricePerM;
                if (mu.pricePerCall !== undefined) t.pricePerCall = mu.pricePerCall;
                target.models[model] = t;
            }
            for (const [src, n] of Object.entries(route.bySource)) {
                const k = src as UsageSource;
                target.bySource[k] = (target.bySource[k] ?? 0) + (n ?? 0);
            }
            acc.set(routeId, target);
        }
    }
    return Array.from(acc.entries())
        .map(([routeId, route]) => ({ routeId, ...route }))
        .sort((a, b) => b.total - a.total);
}

/** 按厂商汇总（同一家多个 key 合并）。 */
export function summarizeByProvider(from?: string, to?: string): Array<UsageTokens & { provider: string; cost?: CostByMode; unpricedCalls?: number }> {
    const acc = new Map<string, UsageTokens & { provider: string; cost?: CostByMode; unpricedCalls?: number }>();
    for (const route of summarizeByRoute(from, to)) {
        const key = route.provider || "未标注";
        const target = acc.get(key) ?? { provider: key, ...emptyTokens() };
        target.prompt += route.prompt;
        target.completion += route.completion;
        target.total += route.total;
        target.calls += route.calls;
        target.cost = addCost(target.cost, route.cost);
        if (route.unpricedCalls) target.unpricedCalls = (target.unpricedCalls ?? 0) + route.unpricedCalls;
        acc.set(key, target);
    }
    return Array.from(acc.values()).sort((a, b) => b.total - a.total);
}

/**
 * 按「入口地址」(baseUrl) 汇总。
 *
 * 为什么需要它：同一个 provider 可能配了多条不同中转站（各自不同 baseUrl、不同计费），
 * 按 provider 汇总会把它们混成一条，看不出「哪个入口在烧钱」。baseUrl 为空的路由
 * 归到「官方默认端点」，用 provider 名标注，避免落进一个无名的桶里。
 */
export function summarizeByBaseUrl(from?: string, to?: string): Array<UsageTokens & { baseUrl: string; label: string; cost?: CostByMode; unpricedCalls?: number }> {
    const acc = new Map<string, UsageTokens & { baseUrl: string; label: string; cost?: CostByMode; unpricedCalls?: number }>();
    for (const route of summarizeByRoute(from, to)) {
        const key = route.baseUrl || `官方默认端点（${route.provider || "未标注"}）`;
        const target = acc.get(key) ?? { baseUrl: key, label: key, ...emptyTokens() };
        target.prompt += route.prompt;
        target.completion += route.completion;
        target.total += route.total;
        target.calls += route.calls;
        target.cost = addCost(target.cost, route.cost);
        if (route.unpricedCalls) target.unpricedCalls = (target.unpricedCalls ?? 0) + route.unpricedCalls;
        acc.set(key, target);
    }
    return Array.from(acc.values()).sort((a, b) => b.total - a.total);
}

/** 账本是否已有任何记录（面板用来决定是否显示空状态引导）。 */
export function hasUsageData(): boolean {
    const ledger = _load();
    return Object.keys(ledger.days).length > 0;
}

/**
 * 从用户配置的单价表里取出该模型的单价。
 *
 * 匹配规则：先精确命中，否则用「最长前缀」命中 —— 这样给 `deepseek-chat` 配的价
 * 能覆盖 `deepseek-chat-v3-0324`、`deepseek-chat:free` 这类带后缀/变体的模型名，
 * 用户不必为每个变体重复填价。前缀必须落在分隔符边界上，避免 `gpt-4` 误配 `gpt-4o`。
 * 故意不做后缀匹配：`xxx-7b` 与 `xxx-72b` 是不同价位，模糊匹配会算错钱。
 */
export function resolveUsagePrice(
    model: string | undefined,
    table: Record<string, ModelPriceConfig> | undefined,
): ModelPriceConfig | undefined {
    if (!model || !table) return undefined;
    if (table[model]) return table[model];

    let best: { key: string; price: ModelPriceConfig } | undefined;
    for (const [key, price] of Object.entries(table)) {
        if (!key || !model.startsWith(key)) continue;
        const boundary = model.charAt(key.length);
        // 前缀必须刚好在分隔符处结束（- . : / 或字符串末尾），否则不是同一模型族。
        if (boundary && !"-.:/".includes(boundary)) continue;
        if (!best || key.length > best.key.length) best = { key, price };
    }
    return best?.price;
}

/** 清空账本。数据管理的「清除」与导入会用到。 */
export function clearUsageLedger(): void {
    try { kvRemove(USAGE_LEDGER_KEY); } catch { /* 忽略 */ }
}

// 与 api-log-store 一致：登记迁移，保证 localStorage 历史键能被搬到 IndexedDB。
registerKvMigration(USAGE_LEDGER_KEY);
