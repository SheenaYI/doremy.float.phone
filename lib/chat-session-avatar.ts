// lib/chat-session-avatar.ts
//
// 「聊天内角色头像覆盖」的兼容垫片。
//
// 上游用这个模块维护一套独立的存储：应用级头像覆盖（chat-app-character-avatars-v1）
// 加上会话级的 characterAvatars / characterAvatarHistories，并带一套旧数据升级逻辑。
// 本仓库没有这套机制 —— 聊天界面一律直接用 character.avatar。
//
// 这里只实现调用方真正需要的那一个函数，并退回到 character.avatar，而不是搬一个
// 残缺的存储层过来：本仓库的会话类型没有那两个字段、character-types 也没有
// CharacterAvatarHistoryEntry，硬搬会让"头像覆盖"看起来可用而实际永远读不到值。
//
// 若将来要做聊天内改角色头像，应完整移植上游那套存储（含 kv 键与迁移），
// 而不是在这个垫片上继续加。

import type { Character } from "./character-types";

/**
 * 解析角色在聊天里显示的头像。
 *
 * 上游签名接受 session 与 character 两个参数（会话可覆盖角色头像）；
 * 本仓库没有会话级覆盖，故只取角色自身的头像。保留 session 形参以兼容调用点，
 * 并在实现里显式忽略它，避免后来者以为这里真的会读会话。
 */
export function getChatCharacterAvatar(
    session: unknown,
    character: Pick<Character, "id" | "avatar"> | null | undefined,
): string | null | undefined {
    void session;
    if (!character) return null;
    return character.avatar ?? null;
}
