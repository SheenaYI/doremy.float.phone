// lib/server/outbound-url-guard.ts
// 服务端出站请求的 SSRF 防线：禁止服务端被诱导去访问本机 / 内网 / 云元数据地址。
//
// 为什么单独成模块：tool-proxy（工具与 MCP 的外部请求代理）与 llm-balance（大模型
// 余额查询代理）都需要同一道校验。复制一份的实现迟早会漂移——安全逻辑一旦两处不一致，
// 就等于按较弱的那一处生效。这里保留唯一实现。

function isPrivateIpv4(host: string): boolean {
    const parts = host.split(".").map(part => Number(part));
    if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
    const [a, b] = parts;
    return a === 0
        || a === 10
        || a === 127
        || (a === 169 && b === 254)
        || (a === 172 && b >= 16 && b <= 31)
        || (a === 192 && b === 168)
        || (a === 100 && b >= 64 && b <= 127);
}

/** 返回拦截原因；通过校验时返回 null。 */
export function blockedOutboundUrlReason(rawUrl: string): string | null {
    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        return "URL 格式不合法";
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
        return "只允许 http/https URL";
    }
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    const isIpv6Literal = host.includes(":");
    const blocked = host === "localhost"
        || host.endsWith(".localhost")
        || host.endsWith(".local")
        || host.endsWith(".internal")
        || host === "::1"
        || host === "0:0:0:0:0:0:0:1"
        || (isIpv6Literal && (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80") || host.startsWith("::ffff:")))
        || isPrivateIpv4(host);
    return blocked ? "不允许代理访问本机或内网地址" : null;
}
