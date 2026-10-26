// lib/memory-tag-compactor.ts
// AI 标签归纳：按房间把同义/近义标签合并成少量 canonical 标签。
// 只输出映射，不改写记忆正文；一次批量写回 registry 与 entry.tags。

import type { MemoryRoom } from "./memory-types";
import { loadMemoryEntriesByType } from "./memory-storage";
import { resolveAuxiliaryApiConfig } from "./settings-storage";
import { simpleLLMCall } from "./api-helpers";
import { MEMORY_ROOMS, MEMORY_ROOM_META } from "./memory-room";
import {
    applyMemoryTagMappings,
    loadMemoryTagRegistry,
} from "./memory-tag-registry";

export type TagCompactScope = "all" | MemoryRoom[];

export type TagCompactResult = {
    success: boolean;
    error?: string;
    mappings: number;
    rooms: number;
};

type RoomTagBucket = {
    room: string;
    label: string;
    tags: Map<string, number>;
};

function normalizeRoomKey(room?: MemoryRoom | ""): string {
    return room || "unfiled";
}

function roomLabel(key: string): string {
    if (key === "unfiled") return "未归档";
    return MEMORY_ROOM_META[key as MemoryRoom]?.label ?? key;
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
    const text = String(raw ?? "").replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
    if (!text) return null;
    try {
        const parsed = JSON.parse(text);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
    } catch {
        const start = text.indexOf("{");
        const end = text.lastIndexOf("}");
        if (start < 0 || end <= start) return null;
        try {
            const parsed = JSON.parse(text.slice(start, end + 1));
            return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
        } catch {
            return null;
        }
    }
}

export async function compactMemoryTags(characterId: string, scope: TagCompactScope = "all"): Promise<TagCompactResult> {
    const apiConfig = resolveAuxiliaryApiConfig("memorySummaryApiConfigId");
    if (!apiConfig) {
        return { success: false, error: "未配置记忆总结 API（请在绑定配置 → 辅助API绑定中设置）", mappings: 0, rooms: 0 };
    }

    const entries = await loadMemoryEntriesByType(characterId, "long_term");
    const selected = new Set(scope === "all" ? [] : scope);
    const buckets = new Map<string, RoomTagBucket>();
    for (const entry of entries) {
        const key = normalizeRoomKey(entry.room);
        if (scope !== "all" && !selected.has(key as MemoryRoom)) continue;
        let bucket = buckets.get(key);
        if (!bucket) {
            bucket = { room: key, label: roomLabel(key), tags: new Map() };
            buckets.set(key, bucket);
        }
        for (const tag of entry.tags ?? []) {
            bucket.tags.set(tag, (bucket.tags.get(tag) ?? 0) + 1);
        }
    }

    const usable = [...buckets.values()].filter(bucket => bucket.tags.size > 0);
    if (usable.length === 0) {
        return { success: false, error: "选中的房间里没有可归纳的标签", mappings: 0, rooms: 0 };
    }

    const registry = loadMemoryTagRegistry(characterId);
    const lines: string[] = [];
    lines.push("你是记忆标签整理助手。请把同一个房间内语义重复、同义或近义的标签合并成更稳定的短标签。");
    lines.push("只输出合并映射，不要改写记忆正文，不要新增与标签无关的内容。");
    lines.push("规则：");
    lines.push("- 只合并真正同义/近义的标签；角色名、地名、专有名词、不同事件不要硬合并。");
    lines.push("- 每个房间合并后保留不超过 20 个标签；优先保留已有的 canonical 标签。");
    lines.push("- 输出 JSON 对象：房间 id -> { \"旧标签\": \"新标签\" }；没有需要合并的房间可以省略。");
    lines.push("- 房间 id 使用下面给出的 key，不要翻译。");
    lines.push("");
    for (const bucket of usable) {
        lines.push(`【${bucket.label}】 key=${bucket.room}`);
        lines.push([...bucket.tags.entries()].map(([tag, count]) => `${tag}(${count})`).join("、"));
    }
    if (registry.length > 0) {
        lines.push("");
        lines.push("已有 canonical 标签（优先复用）：");
        lines.push(registry.filter(tag => !tag.hidden).slice(0, 80).map(tag => tag.label).join("、"));
    }
    lines.push("");
    lines.push("输出示例：");
    lines.push('{"living":{"和TA约会":"约会","约会中":"约会"},"bedroom":{"睡不着":"失眠"}}');

    const result = await simpleLLMCall(apiConfig, [{ role: "user", content: lines.join("\n") }], {
        temperature: 0.1,
        max_tokens: 3000,
        label: "标签归纳",
        allowReasoningFallback: false,
    });
    if (!result.content) {
        return { success: false, error: result.error || "标签归纳没有返回内容", mappings: 0, rooms: 0 };
    }

    const parsed = parseJsonObject(result.content);
    if (!parsed) {
        return { success: false, error: "标签归纳结果不是有效 JSON", mappings: 0, rooms: 0 };
    }

    const allowedRooms = new Set(MEMORY_ROOMS as string[]);
    const mappings: Array<{ from: string; to: string }> = [];
    let roomCount = 0;
    for (const [roomKey, roomMap] of Object.entries(parsed)) {
        if (roomKey !== "unfiled" && !allowedRooms.has(roomKey)) continue;
        if (!roomMap || typeof roomMap !== "object" || Array.isArray(roomMap)) continue;
        let used = false;
        for (const [from, to] of Object.entries(roomMap as Record<string, unknown>)) {
            if (typeof to !== "string") continue;
            const source = from.trim();
            const target = to.trim();
            if (!source || !target || source === target) continue;
            mappings.push({ from: source, to: target });
            used = true;
        }
        if (used) roomCount += 1;
    }

    if (mappings.length === 0) {
        return { success: true, mappings: 0, rooms: 0 };
    }
    await applyMemoryTagMappings(characterId, mappings);
    return { success: true, mappings: mappings.length, rooms: roomCount };
}
