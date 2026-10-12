// app/api/llm-balance/route.ts
// 大模型账号余额查询代理。
//
// 为什么必须走服务端：
//   1. CORS —— DeepSeek 官方 /user/balance 不允许浏览器直连，前端 fetch 必被拦；
//   2. 密钥不出本机网络层之外的不必要暴露 —— 由服务端代发，浏览器不直接对第三方裸奔。
//
// 设计原则：只回报能证实的数字。
//   各家（官方 / one-api / new-api / 中转站）余额接口的形状并不统一，其中中转站的额度
//   常以「内部 quota 单位」计量，换算成货币需要服务端的充值比例，而该比例未必可读。
//   这种情况下宁可如实说明「单位未知」，也不乘一个猜出来的系数 —— 一个看起来精确却错误的
//   余额比「查不出」更糟。因此响应里带 unit/note 字段标注口径。

import { NextRequest, NextResponse } from "next/server";
import { ProxyAgent, fetch as undiciFetch, type Dispatcher } from "undici";
import { blockedOutboundUrlReason } from "@/lib/server/outbound-url-guard";

export const maxDuration = 30;

/** 与 tool-proxy 一致：代理环境（Clash/Mihomo）下 Node 的 fetch 默认不读 HTTP(S)_PROXY。 */
function getProxyDispatcher(): Dispatcher | undefined {
    const proxyUrl = process.env.https_proxy || process.env.HTTPS_PROXY
        || process.env.http_proxy || process.env.HTTP_PROXY;
    if (!proxyUrl) return undefined;
    try {
        return new ProxyAgent(proxyUrl);
    } catch {
        return undefined;
    }
}

type BalanceEntry = {
    /** 可用余额 */
    total?: number;
    /** 赠金 */
    granted?: number;
    /** 充值余额 */
    toppedUp?: number;
    /** 已用额度（OpenRouter 等提供） */
    used?: number;
    /** 货币单位；未知时为 undefined */
    currency?: string;
    /** 数值口径说明，例如「内部 quota 单位，未换算为货币」 */
    unit?: string;
};

type BalancePayload = {
    ok: boolean;
    entries?: BalanceEntry[];
    /** 是否仍有余额可用（DeepSeek 的 is_available） */
    available?: boolean;
    /** 端点原始响应形状的识别结果，便于排查 */
    shape?: string;
    /** 失败原因（ok=false 时） */
    error?: string;
    /** 附加说明，例如「该中转站未提供可换算的货币余额」 */
    note?: string;
};

const TIMEOUT_MS = 12_000;

function num(v: unknown): number | undefined {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    // 很多接口把金额以字符串返回（DeepSeek 就是 "110.00"），必须转
    if (typeof v === "string" && v.trim() !== "") {
        const n = Number(v);
        if (Number.isFinite(n)) return n;
    }
    return undefined;
}

function obj(v: unknown): Record<string, unknown> | undefined {
    return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : undefined;
}

async function fetchJson(url: string, apiKey: string): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
    const blocked = blockedOutboundUrlReason(url);
    if (blocked) return { ok: false, error: blocked };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const dispatcher = getProxyDispatcher();
        const res = await undiciFetch(url, {
            method: "GET",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                Accept: "application/json",
                // 部分中转站按 UA 区分 Web/API 请求，缺失时返回 HTML 登录页而非 JSON
                "User-Agent": "ai-virtual-phone/1.0 (+balance-check)",
            },
            signal: controller.signal,
            ...(dispatcher ? { dispatcher } : {}),
        });
        if (!res.ok) {
            const text = await res.text().catch(() => "");
            const trimmed = text.replace(/\s+/g, " ").trim().slice(0, 200);
            return { ok: false, error: `HTTP ${res.status}${trimmed ? `: ${trimmed}` : ""}` };
        }
        const text = await res.text();
        try {
            return { ok: true, data: JSON.parse(text) };
        } catch {
            // 返回非 JSON 通常意味着请求落到了登录页/门户页，明确说出来比「解析失败」有用
            return { ok: false, error: "响应不是 JSON（可能落到了登录页或门户页）" };
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: controller.signal.aborted ? `超时（${TIMEOUT_MS / 1000}s）` : msg };
    } finally {
        clearTimeout(timer);
    }
}

/** DeepSeek 官方：GET /user/balance（已对照官方文档的 schema 实现）。 */
async function queryDeepSeek(baseUrl: string, apiKey: string): Promise<BalancePayload> {
    const res = await fetchJson(`${baseUrl}/user/balance`, apiKey);
    // 整体判断 res.ok 再做类型收窄；解构会丢掉判别联合的收窄信息
    if (!res.ok) return { ok: false, error: res.error, shape: "deepseek" };
    const root = obj(res.data);
    const infos = root?.balance_infos;
    if (!Array.isArray(infos)) return { ok: false, error: "响应里没有 balance_infos 字段", shape: "deepseek" };
    const entries: BalanceEntry[] = infos.map(item => {
        const e = obj(item) ?? {};
        return {
            total: num(e.total_balance),
            granted: num(e.granted_balance),
            toppedUp: num(e.topped_up_balance),
            currency: typeof e.currency === "string" ? e.currency : undefined,
        };
    }).filter(e => e.total !== undefined || e.granted !== undefined || e.toppedUp !== undefined);
    if (entries.length === 0) return { ok: false, error: "balance_infos 里没有可解析的金额", shape: "deepseek" };
    return {
        ok: true,
        entries,
        available: typeof root?.is_available === "boolean" ? root.is_available : undefined,
        shape: "deepseek",
    };
}

/** OpenRouter：GET /api/v1/credits → { data: { total_credits, total_usage } }。 */
async function queryOpenRouter(baseUrl: string, apiKey: string): Promise<BalancePayload> {
    const res = await fetchJson(`${baseUrl}/api/v1/credits`, apiKey);
    if (!res.ok) return { ok: false, error: res.error, shape: "openrouter" };
    const root = obj(res.data);
    const d = obj(root?.data);
    const total = num(d?.total_credits);
    const used = num(d?.total_usage);
    if (total === undefined && used === undefined) {
        return { ok: false, error: "响应里没有 total_credits / total_usage", shape: "openrouter" };
    }
    // OpenRouter 的「剩余」需要自己相减，接口只给总额与已用
    const remaining = total !== undefined && used !== undefined ? total - used : total;
    return {
        ok: true,
        entries: [{ total: remaining, used, currency: "USD" }],
        shape: "openrouter",
    };
}

/**
 * OpenAI 兼容中转站（one-api / new-api / sub2api 及其分支）。
 *
 * 这类站点把余额放在 /api/user/self 的 data.quota，单位是站内 quota（不是货币），
 * 换算需要站点的充值比例。比例拿不到时只回报 quota 原值并标注单位，不猜汇率。
 */
async function queryRelay(baseUrl: string, apiKey: string): Promise<BalancePayload> {
    const res = await fetchJson(`${baseUrl}/api/user/self`, apiKey);
    if (!res.ok) return { ok: false, error: res.error, shape: "relay" };
    const root = obj(res.data);
    const d = obj(root?.data) ?? root;
    if (!d) return { ok: false, error: "响应里没有 data 字段", shape: "relay" };

    const quota = num(d.quota) ?? num(d.remain_quota) ?? num(d.remaining);
    const used = num(d.used_quota) ?? num(d.used);
    const display = obj(d.display) ?? obj(d.setting);
    // 部分分支把换算后的金额直接放在这些字段里，有就用，没有就不编
    const displayTotal = num(display?.quota) ?? num(display?.balance);
    if (quota === undefined && used === undefined && displayTotal === undefined) {
        return {
            ok: false,
            error: "响应里没有可识别的余额字段（quota / used_quota）",
            shape: "relay",
        };
    }
    const hasMoney = displayTotal !== undefined;
    return {
        ok: true,
        entries: [{
            total: hasMoney ? displayTotal : quota,
            used,
            currency: hasMoney ? undefined : undefined,
            unit: hasMoney ? undefined : "站内 quota 单位（未换算为货币）",
        }],
        shape: "relay",
        note: hasMoney ? undefined : "该中转站未返回货币金额，显示的是站内额度单位",
    };
}

/** 去掉结尾斜杠，避免拼出 //user/balance 这种被某些网关判为不同路由的地址。 */
function trimBase(baseUrl: string): string {
    return baseUrl.trim().replace(/\/+$/, "");
}

export async function POST(req: NextRequest) {
    let body: unknown;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ ok: false, error: "请求体不是合法 JSON" } satisfies BalancePayload, { status: 400 });
    }
    const b = obj(body);
    const apiKey = typeof b?.apiKey === "string" ? b.apiKey.trim() : "";
    const baseUrl = typeof b?.baseUrl === "string" ? trimBase(b.baseUrl) : "";
    const provider = typeof b?.provider === "string" ? b.provider : "";

    if (!apiKey) return NextResponse.json({ ok: false, error: "缺少 apiKey" } satisfies BalancePayload, { status: 400 });
    if (!baseUrl) return NextResponse.json({ ok: false, error: "缺少 baseUrl" } satisfies BalancePayload, { status: 400 });
    const blocked = blockedOutboundUrlReason(baseUrl);
    if (blocked) return NextResponse.json({ ok: false, error: blocked } satisfies BalancePayload, { status: 400 });

    // 端点选择：显式 provider 优先，其次按 baseUrl 反推，最后按中转站兜底。
    // 之所以要反推：用户往往只填了 Base URL，provider 可能是自定义名。
    const lower = `${provider} ${baseUrl}`.toLowerCase();
    let payload: BalancePayload;
    if (lower.includes("deepseek")) {
        payload = await queryDeepSeek(baseUrl, apiKey);
    } else if (lower.includes("openrouter")) {
        payload = await queryOpenRouter(baseUrl, apiKey);
    } else {
        payload = await queryRelay(baseUrl, apiKey);
        // 中转站端点失败时再试一次 DeepSeek 形状：部分中转站直接透传官方 /user/balance
        if (!payload.ok) {
            const alt = await queryDeepSeek(baseUrl, apiKey);
            if (alt.ok) payload = alt;
        }
    }
    return NextResponse.json({ ...payload, provider, baseUrl });
}
