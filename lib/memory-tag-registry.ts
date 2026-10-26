// lib/memory-tag-registry.ts
// 每角色标签注册表：把 AI 自由生成的标签收敛到稳定词表。
// 设计原则：不重写记忆正文；只维护 canonical label + aliases，旧标签可随时合并/隐藏。

import { kvGet, kvSet, registerKvMigration } from "./kv-db";
import { normalizeMemoryTags } from "./memory-room";
import { loadMemoryEntries, patchMemoryEntries } from "./memory-storage";

export type MemoryTagKind = "core" | "auto";

export type MemoryTagRecord = {
    id: string;
    label: string;
    aliases: string[];
    kind: MemoryTagKind;
    usage: number;
    createdAt: string;
    lastUsedAt: string;
    hidden?: boolean;
};

type TagStore = Record<string, MemoryTagRecord[]>;

const KEY = "ai_phone_memory_tag_registry_v1";
registerKvMigration(KEY);

/** 新角色可用的稳定分类；不会自动绑定到每条记忆，只在需要时作为 core 标签使用。 */
export const CORE_MEMORY_TAG_SUGGESTIONS = [
    "日常",
    "关系",
    "剧情",
    "承诺",
    "冲突",
    "地点",
    "物件",
    "情绪",
    "工作",
    "其他",
];

function hasWindow(): boolean {
    return typeof window !== "undefined";
}

function loadStore(): TagStore {
    if (!hasWindow()) return {};
    try {
        const raw = kvGet(KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw) as unknown;
        return parsed && typeof parsed === "object" ? parsed as TagStore : {};
    } catch {
        return {};
    }
}

function saveStore(store: TagStore): void {
    if (!hasWindow()) return;
    kvSet(KEY, JSON.stringify(store));
}

function normalizeKey(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, "");
}

function makeTagId(label: string): string {
    return `tag_${Date.now().toString(36)}_${label.slice(0, 8).replace(/\s/g, "")}_${Math.random().toString(36).slice(2, 6)}`;
}

function cleanLabel(value: string): string {
    return value
        .replace(/^[#＃\s]+/, "")
        .replace(/[。，,；;：:！!？?]+$/g, "")
        .trim()
        .slice(0, 12);
}

export function loadMemoryTagRegistry(characterId: string): MemoryTagRecord[] {
    const list = loadStore()[characterId] ?? [];
    return [...list].sort((a, b) => {
        if (a.hidden !== b.hidden) return a.hidden ? 1 : -1;
        if (a.kind !== b.kind) return a.kind === "core" ? -1 : 1;
        if (a.usage !== b.usage) return b.usage - a.usage;
        return a.label.localeCompare(b.label);
    });
}

export function saveMemoryTagRegistry(characterId: string, tags: MemoryTagRecord[]): void {
    if (!characterId) return;
    const store = loadStore();
    store[characterId] = tags;
    saveStore(store);
}

function findCanonical(tags: MemoryTagRecord[], raw: string): MemoryTagRecord | null {
    const key = normalizeKey(raw);
    if (!key) return null;
    return tags.find(tag => normalizeKey(tag.label) === key)
        ?? tags.find(tag => tag.aliases.some(alias => normalizeKey(alias) === key))
        ?? null;
}

function touchTag(tag: MemoryTagRecord, now: string): void {
    tag.usage += 1;
    tag.lastUsedAt = now;
}

/**
 * 把 AI / 手动输入的一批标签归一到角色词表。
 * - 命中 label/alias -> 使用已有 canonical label
 * - 未命中 -> 登记为 auto 候选
 * - 同一批内去重，最多 4 个
 */
export function resolveMemoryTags(characterId: string, rawTags: unknown, limit = 4): string[] {
    if (!characterId) return [];
    const cleaned = normalizeMemoryTags(rawTags, limit);
    if (cleaned.length === 0) return [];

    const store = loadStore();
    const tags = store[characterId] ?? [];
    const now = new Date().toISOString();
    const output: string[] = [];
    const seen = new Set<string>();

    for (const raw of cleaned) {
        const label = cleanLabel(raw);
        if (!label) continue;
        let record = findCanonical(tags, label);
        if (!record) {
            record = {
                id: makeTagId(label),
                label,
                aliases: [],
                kind: "auto",
                usage: 0,
                createdAt: now,
                lastUsedAt: now,
            };
            tags.push(record);
        }
        touchTag(record, now);
        const key = normalizeKey(record.label);
        if (seen.has(key)) continue;
        seen.add(key);
        output.push(record.label);
    }

    store[characterId] = tags;
    saveStore(store);
    return output;
}

/** 手动把标签登记成 core（例如把「约定」固定下来）。 */
export function setMemoryTagCore(characterId: string, label: string, core: boolean): void {
    const tags = loadStore()[characterId] ?? [];
    const record = findCanonical(tags, label);
    if (record) {
        record.kind = core ? "core" : "auto";
        saveMemoryTagRegistry(characterId, tags);
    }
}

export function setMemoryTagHidden(characterId: string, label: string, hidden: boolean): void {
    const tags = loadStore()[characterId] ?? [];
    const record = findCanonical(tags, label);
    if (record) {
        record.hidden = hidden;
        saveMemoryTagRegistry(characterId, tags);
    }
}

/**
 * 合并标签：source -> target。
 * 同时把已有记忆条目里的 source 改写成 target，避免只改词表、旧记录仍带旧词。
 */
export async function mergeMemoryTags(characterId: string, sourceLabel: string, targetLabel: string): Promise<number> {
    if (!characterId || normalizeKey(sourceLabel) === normalizeKey(targetLabel)) return 0;
    const tags = loadStore()[characterId] ?? [];
    const source = findCanonical(tags, sourceLabel);
    const target = findCanonical(tags, targetLabel);
    if (!source || !target) return 0;

    target.aliases = Array.from(new Set([
        ...target.aliases,
        source.label,
        ...source.aliases,
    ].filter(alias => normalizeKey(alias) !== normalizeKey(target.label))));
    target.usage += source.usage;
    target.lastUsedAt = new Date().toISOString();
    const next = tags.filter(tag => tag.id !== source.id);
    saveMemoryTagRegistry(characterId, next);

    const entries = await loadMemoryEntries(characterId);
    const patches = entries.map(entry => {
        const current = entry.tags ?? [];
        if (!current.some(tag => normalizeKey(tag) === normalizeKey(source.label))) return null;
        const mapped = Array.from(new Set(current.map(tag => normalizeKey(tag) === normalizeKey(source.label) ? target.label : tag)));
        return { id: entry.id, tags: mapped };
    }).filter((patch): patch is { id: string; tags: string[] } => Boolean(patch));
    return patchMemoryEntries(patches);
}

/** 重命名 canonical 标签，并把旧名保留为 alias。 */
export async function renameMemoryTag(characterId: string, oldLabel: string, newLabel: string): Promise<number> {
    const label = cleanLabel(newLabel);
    if (!characterId || !label) return 0;
    const tags = loadStore()[characterId] ?? [];
    const record = findCanonical(tags, oldLabel);
    if (!record || normalizeKey(record.label) === normalizeKey(label)) return 0;
    const old = record.label;
    record.label = label;
    record.aliases = Array.from(new Set([...record.aliases, old].filter(alias => normalizeKey(alias) !== normalizeKey(label))));
    record.lastUsedAt = new Date().toISOString();
    saveMemoryTagRegistry(characterId, tags);

    const entries = await loadMemoryEntries(characterId);
    const patches = entries.map(entry => {
        const current = entry.tags ?? [];
        if (!current.some(tag => normalizeKey(tag) === normalizeKey(old))) return null;
        return {
            id: entry.id,
            tags: Array.from(new Set(current.map(tag => normalizeKey(tag) === normalizeKey(old) ? label : tag))),
        };
    }).filter((patch): patch is { id: string; tags: string[] } => Boolean(patch));
    return patchMemoryEntries(patches);
}

/** 从已有记忆补登记未入表的标签，供首次打开标签管理时迁移旧数据。 */
export async function seedMemoryTagRegistryFromEntries(characterId: string): Promise<number> {
    const entries = await loadMemoryEntries(characterId);
    const tags = loadStore()[characterId] ?? [];
    const now = new Date().toISOString();
    let added = 0;
    for (const entry of entries) {
        for (const raw of entry.tags ?? []) {
            const label = cleanLabel(raw);
            if (!label || findCanonical(tags, label)) continue;
            tags.push({
                id: makeTagId(label),
                label,
                aliases: [],
                kind: "auto",
                usage: 0,
                createdAt: now,
                lastUsedAt: now,
            });
            added += 1;
        }
    }
    if (added > 0) saveMemoryTagRegistry(characterId, tags);
    return added;
}
