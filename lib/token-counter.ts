// lib/token-counter.ts
// Lightweight token estimation — zero external dependencies.
// CJK characters ~ 1.5 char/token, Latin ~ 4 char/token, +4 overhead per message.

const CJK_RANGE = /[\u2E80-\u9FFF\uF900-\uFAFF\uFE30-\uFE4F\u3000-\u303F\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF]/g;

const tokenCache = new Map<string, number>();
let tokenCacheChars = 0;
export function estimateTokens(text: string): number {
    if (!text) return 0;
    const cached = tokenCache.get(text); if (cached !== undefined) return cached;
    let cjkCount = 0;
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if ((code >= 0x2e80 && code <= 0x9fff) || (code >= 0xf900 && code <= 0xfaff)
            || (code >= 0xfe30 && code <= 0xfe4f) || (code >= 0xac00 && code <= 0xd7af)) cjkCount++;
    }
    const result = Math.ceil(cjkCount / 1.5 + (text.length - cjkCount) / 4);
    if (text.length <= 32768) {
        while (tokenCache.size >= 2000 || tokenCacheChars + text.length > 1000000) {
            const key = tokenCache.keys().next().value; if (key === undefined) break;
            tokenCache.delete(key); tokenCacheChars -= key.length;
        }
        tokenCache.set(text, result); tokenCacheChars += text.length;
    }
    return result;
}

export function estimateMessagesTokens(messages: { role: string; content: string }[]): number {
    let total = 0;
    for (const msg of messages) {
        total += estimateTokens(msg.content) + 4; // per-message overhead
    }
    return total + 2; // conversation overhead
}

export function remainingTokenBudget(
    maxContext: number,
    currentTokens: number,
    reserveForGeneration: number = 500
): number {
    return Math.max(0, maxContext - currentTokens - reserveForGeneration);
}
