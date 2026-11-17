// lib/llm-http.ts
// LLM 请求的统一 fetch 出口。所有走 buildProviderRequest 的调用点统一经它发请求：
//  - 普通 provider：浏览器直连（现状不变）；
//  - serverProxy 标记（OpenCode 网关）：改发本站 /api/llm-proxy，由服务端转发，
//    绕过 opencode.ai 未开放浏览器 CORS 的问题。

import type { LlmRequestPayload } from "./llm-provider-adapter";
import { recordPerformanceMetric } from "./performance-diagnostics";

export type FetchLlmPayloadOptions = {
    signal?: AbortSignal;
};

export function fetchLlmPayload(
    payload: LlmRequestPayload,
    options: FetchLlmPayloadOptions = {},
): Promise<Response> {
    const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
    const startedAt = now();
    const bodyText = JSON.stringify(payload.body);
    recordPerformanceMetric("llm.fetch.serialize", now() - startedAt, { bodyChars: bodyText.length });
    const requestStartedAt = now();
    const request = payload.serverProxy
        ? fetch("/api/llm-proxy", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                url: payload.url,
                headers: payload.headers,
                body: bodyText,
            }),
            signal: options.signal,
        })
        : fetch(payload.url, {
            method: "POST",
            headers: payload.headers,
            body: bodyText,
            signal: options.signal,
        });
    // 只统计到响应头到达：这段就是「服务端开始回包」的等待时间。
    // 若它接近用户感知的 2s，而 prompt.*.build 与长任务都不高，说明是模型首包延迟。
    return request.then(response => {
        recordPerformanceMetric("llm.fetch.headers", now() - requestStartedAt, {
            status: response.status,
        });
        return response;
    });
}
