// lib/memory-injector.ts
// Formats memory entries into injectable prompt text.

import type { MemoryEntry, MemoryRoom } from "./memory-types";
import { MEMORY_ROOM_META, MEMORY_ROOMS } from "./memory-room";

/**
 * 来源标签：让模型和提示词查看器都能看出这条记忆来自哪个模块。
 * 旧记忆没有 metadata.sourceChannel 时用 sourceApp 兜底。
 */
const SOURCE_LABELS: Record<string, string> = {
    chat: "聊天",
    group_chat: "群聊",
    call: "通话",
    call_end: "通话结尾",
    story: "剧情",
    vn: "视觉小说",
    map: "跑团",
    adventure: "冒险",
    game: "游戏",
    moments: "朋友圈",
    diary: "日记",
    notewall: "便签墙",
    xiaohongshu: "小红书",
    checkphone: "查手机",
    interview_magazine: "访谈",
    cocreate: "共创",
    custom_app: "自定义APP",
    life: "生活",
    life_scene: "生活现场",
    life_autonomy: "生活主动",
    life_offline: "生活离线",
    weixin: "微信",
    reality_bridge: "现实桥",
    offline: "线下",
};

export function memorySourceLabel(entry: MemoryEntry): string {
    const metadata = entry.metadata ?? {};
    const channel = typeof metadata.sourceChannel === "string" ? metadata.sourceChannel : "";
    const sourceModule = typeof metadata.sourceModule === "string" ? metadata.sourceModule : "";
    return SOURCE_LABELS[channel] || SOURCE_LABELS[sourceModule] || SOURCE_LABELS[entry.sourceApp] || entry.sourceApp;
}

function formatMemoryLine(entry: MemoryEntry): string {
    const date = entry.createdAt?.slice(0, 10) || "";
    const label = memorySourceLabel(entry);
    return `- [来源：${label}${date ? `｜${date}` : ""}] ${entry.content}`;
}

/**
 * Format long-term memories for prompt injection.
 *
 * 记忆宫殿（options.groupByRoom = true）时按房间分组输出：
 *   <room name="客厅">
 *   - 记忆内容
 *   </room>
 *
 * 退化成旧格式的条件：开关关闭，或所有条目都没有房间。
 * 这样未开启记忆宫殿时，注入文本与旧版一字不差。
 */
export function formatLongTermMemories(
    memories: MemoryEntry[],
    options?: { groupByRoom?: boolean },
): string {
    if (memories.length === 0) return "";

    const grouped = options?.groupByRoom === true && memories.some(entry => Boolean(entry.room));
    if (!grouped) {
        return memories.map(formatMemoryLine).join("\n");
    }

    const blocks: string[] = [];
    for (const room of MEMORY_ROOMS) {
        const items = memories.filter(entry => entry.room === room);
        if (items.length === 0) continue;
        blocks.push(formatRoomBlock(room, items));
    }

    const unfiled = memories.filter(entry => !entry.room);
    if (unfiled.length > 0) {
        blocks.push(formatPlainBlock("未归档", unfiled));
    }

    return blocks.join("\n");
}

function formatRoomBlock(room: MemoryRoom, items: MemoryEntry[]): string {
    return formatPlainBlock(MEMORY_ROOM_META[room]?.label ?? room, items);
}

function formatPlainBlock(label: string, items: MemoryEntry[]): string {
    const lines = items.map(formatMemoryLine);
    return [`<room name="${label}">`, ...lines, "</room>"].join("\n");
}

export function formatCoreMemories(memories: MemoryEntry[]): string {
    if (memories.length === 0) return "";
    return memories.map(formatMemoryLine).join("\n");
}
