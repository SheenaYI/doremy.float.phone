// lib/music-listening-capture.ts
// 发送消息时捕获"此刻在听什么"的歌词上下文。
// 移植自 Yyk-Y2k/ai-virtual-phone-Y2Kversion（AGPL-3.0）。

import { assertIdentityActive, getCurrentIdentityId } from "./local-identity";
import { type MusicListeningContext } from "./music-listening";

/**
 * 捕获歌词上下文。
 *
 * 只在「用户明确带了一份歌词引用」时返回数据，普通聊天返回 null。
 *
 * 这个"只在有引用时才带上"的行为是刻意的，不是保守：
 *   - 歌词属于用户主动分享的内容。普通发言没有引用，若也附上上下文，每条消息都会
 *     带一份语境，既无用途又污染历史，还会让下游「历史里是否出现过音乐内容」这类
 *     判断失去意义（它本该只在真有音乐内容时为真）。
 *   - 上游的实现与它的回归测试（scripts/check-music-listening.cjs）都以此契约为准，
 *     其中明确断言"ordinary chat captures no live lyrics"。
 *
 * 歌词进入消息的正道是引用链：播放器选中歌词 → 生成带 reference 的上下文 →
 * 作为待发送草稿的 listeningContext → 用户发送时由消息继承（chat-room 的发送路径
 * 会把引用消息的 listeningContext 传进来）。
 *
 * 注：本文件早前曾被我改成"没有引用时也从播放器快照现场构建"，那是错的 ——
 * 它会让每条消息都带上下文。现按上游契约改回。
 */
export function captureMusicListeningContext(
    capturedAt = new Date().toISOString(),
    reference?: MusicListeningContext | null,
): MusicListeningContext | null {
    assertIdentityActive();
    const owner = getCurrentIdentityId();
    if (reference?.reference && reference.identityId === owner) {
        // 选中的那句歌词要跟随它原本的来源歌曲：即使播放已经换歌，
        // 引用仍应指向用户当时分享的那一首，否则会张冠李戴。
        return {
            ...reference,
            capturedAt,
            lines: reference.lines.map(line => ({ ...line })),
            reference: { ...reference.reference },
        };
    }
    return null;
}
