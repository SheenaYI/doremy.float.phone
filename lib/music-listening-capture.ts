// lib/music-listening-capture.ts
// 发送消息时捕获"此刻在听什么"的歌词上下文。
// 移植自 Yyk-Y2k/ai-virtual-phone-Y2Kversion（AGPL-3.0）。

import { assertIdentityActive, getCurrentIdentityId } from "./local-identity";
import { getMusicControlBridge } from "./music-control-bridge";
import { createMusicListeningContext, type MusicListeningContext, type TimedLyric } from "./music-listening";

/**
 * 捕获当前的歌词上下文。
 *
 * 两种情况：
 *   1. 用户明确选了某句歌词（reference）→ 沿用它的歌曲与歌词行，只刷新捕获时间。
 *      即使播放已换歌，引用仍指向用户当时分享的那一首，否则会张冠李戴。
 *   2. 没有引用 → 从播放器快照现场构建：这样才能把"正在播放、唱到第几句"带给模型。
 *
 * 原版只实现了第 1 种（它另有调用点在发送时先建好 reference）。这里补上现场构建，
 * 否则普通发送消息时 listeningContext 永远是空的，整个歌词上下文等于没接。
 */
export function captureMusicListeningContext(
    capturedAt = new Date().toISOString(),
    reference?: MusicListeningContext | null,
): MusicListeningContext | null {
    assertIdentityActive();
    const owner = getCurrentIdentityId();

    if (reference?.reference && reference.identityId === owner) {
        return {
            ...reference,
            capturedAt,
            lines: reference.lines.map(line => ({ ...line })),
            reference: { ...reference.reference },
        };
    }

    const snapshot = getMusicControlBridge()?.getState();
    if (!snapshot) return null;

    // 用户选中的歌词行作为 reference 传入时，直接交给构建函数带上。
    const selectedLyric: TimedLyric | undefined = reference?.reference
        ? { time: reference.reference.time, text: reference.reference.text }
        : undefined;

    return createMusicListeningContext(snapshot, owner, capturedAt, selectedLyric) ?? null;
}
