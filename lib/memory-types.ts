// lib/memory-types.ts

import type { ContentAppId } from "./settings-types";
import { defaultRoomBudgets, defaultRoomPrompts, defaultRoomResidentFlags, MEMORY_ROOMS } from "./memory-room";

/**
 * 记忆宫殿房间。
 * 房间是长期记忆的一个标签（一条记忆只有一个主房间），不是独立的存储层。
 * undefined = 未归档（旧数据默认）。
 */
export type MemoryRoom = "living" | "bedroom" | "collection" | "self" | "study" | "windowsill";

export type MemoryEntry = {
    id: string;
    characterId: string;
    sourceApp: ContentAppId;
    type: "long_term" | "core";
    content: string;
    embedding?: number[];
    importance: number;         // 0-1
    createdAt: string;
    updatedAt: string;
    sourceMessageIds?: string[];
    metadata?: Record<string, unknown>;
    /** 记忆宫殿房间；undefined = 未归档 */
    room?: MemoryRoom;
    /** 置顶：不参与房间预算截断与超额淘汰 */
    pinned?: boolean;
    /** 记忆标签（#关键词），用于档案页筛选与展示；不影响注入 */
    tags?: string[];
};

export type MemoryConfig = {
    autoSummarizeEnabled: boolean;          // whether auto-summarization runs after N events
    autoBuildCoreEnabled: boolean;          // whether core memories rebuild after long-term summarization
    vectorRecallEnabled: boolean;           // whether vector embedding recall is used for memory retrieval
    maxLongTermEntries: number;
    summarizationEventInterval: number;     // trigger summarization every N events
    coreSummarizationInterval: number;      // trigger core-memory rebuild every N new long-term memories
    shortTermTokenBudget: number;           // token limit for short-term event log
    coreMemoryTokenBudget: number;          // token limit for injected core memories
    longTermTokenBudget: number;            // token limit for injected long-term memories
    summarizationPrompt: string;            // user-editable prompt template for memory summarization
    coreMemoryPrompt: string;               // user-editable prompt template for core-memory extraction
    vnSummaryPrompt: string;                // user-editable prompt for VN chapter summarization
    /** 独立控制哪些来源参与长期记忆总结；不影响短期提示词注入。 */
    longTermAllowedSources?: {
        chat?: boolean; group_chat?: boolean; moments?: boolean; checkphone?: boolean; diary?: boolean;
        calendar?: boolean;
        xiaohongshu?: boolean; interview_magazine?: boolean; cocreate?: boolean; game?: boolean;
        story?: boolean; vn?: boolean; adventure?: boolean; custom_app?: boolean; photo_wall?: boolean;
        life?: boolean; phone_widget?: boolean; watch?: boolean; global_watch?: boolean;
    };
    shortTermAllowedSources?: {
        chat?: boolean;
        group_chat?: boolean;
        moments?: boolean;
        checkphone?: boolean;
        diary?: boolean;
        calendar?: boolean;
        xiaohongshu?: boolean;
        interview_magazine?: boolean;
        cocreate?: boolean;
        game?: boolean;
        story?: boolean;
        vn?: boolean;
        adventure?: boolean;
        custom_app?: boolean;
        photo_wall?: boolean;
        life?: boolean;
        phone_widget?: boolean;
        watch?: boolean;
        global_watch?: boolean;
    };
    /** 每个消费 APP 从所有已允许来源合并读取的短期记忆总条数上限；0=不限制。最终仍受 shortTermTokenBudget 约束。 */
    /** Internal one-time settings migration marker; does not affect stored memories. */
    shortTermLimitVersion?: number;
    shortTermAppLimits?: {
        chat?: number; group_chat?: number; life?: number; photo_wall?: number; watch?: number;
        global_watch?: number; phone_widget?: number; story?: number; vn?: number; adventure?: number;
        interview_magazine?: number; cocreate?: number; diary?: number; moments?: number;
        checkphone?: number; xiaohongshu?: number; game?: number; map?: number; custom_app?: number;
    };
    /** @deprecated 旧版按来源裁剪；保留读取兼容，不再作为注入上限。 */
    shortTermSourceLimits?: {
        chat?: number;
        group_chat?: number;
        moments?: number;
        checkphone?: number;
        photo_wall?: number;
        life?: number;
        phone_widget?: number;
        watch?: number;
        global_watch?: number;
        story?: number;
        vn?: number;
        map?: number;
        game?: number;
        diary?: number;
        xiaohongshu?: number;
        interview_magazine?: number;
        cocreate?: number;
        custom_app?: number;
    };

    // ── 记忆宫殿（房间）─────────────────────────────
    /** 总开关。false = 完全保持旧行为（房间字段不生效、注入不分组、淘汰仍是 FIFO）。 */
    roomEnabled: boolean;
    /** 每个房间的归档标准（生成 {{roomSpec}} 用，可被用户改写） */
    roomPrompts: Record<MemoryRoom, string>;
    /** 参与总结的房间；空 = 全部 */
    roomPromptRooms: MemoryRoom[];
    /** 每房间注入预算（token） */
    roomBudgets: Record<MemoryRoom, number>;
    /** 每房间是否常驻（常驻房间优先占位、房内不被预算挤掉） */
    roomResident: Record<MemoryRoom, boolean>;
    /** 注入截断模式：global = 沿用单一总预算；perRoom = 启用房间预算分配 */
    roomTruncationMode: "global" | "perRoom";
    /** 核心记忆是否按房间过滤喂料（false = 吃全部长期记忆，保持旧行为） */
    coreMemoryRoomFilterEnabled: boolean;
    /** 核心记忆喂料的房间 */
    coreMemoryRooms: MemoryRoom[];
    /** 「重新归档房间」时跳过用户手动修改过的条目 */
    reclassifySkipManual: boolean;
};

export type MemorySearchResult = {
    entry: MemoryEntry;
    score: number;
};

/**
 * 旧版（无房间）总结提示词原文。
 * 保留它是为了做模板迁移比对：只有当用户配置里的提示词与本常量完全一致时，
 * 才说明用户从没改过，可以安全地自动换成房间版模板。
 */
export const DEFAULT_SUMMARIZATION_PROMPT_PLAIN = `你是一个记忆整理助手。根据以下事件记录，创建一段简洁的事实性总结。

角色：{{char}}
时间跨度：{{earliest}} 至 {{latest}}

事件记录：
{{events}}

要求：
- 用第三人称描述{{char}}和用户之间的互动
- 保留关键事实：提到的名字、做出的承诺、情感变化、关系里程碑
- 保留用户分享的具体信息（生日、偏好、习惯）
- 保留朋友圈等非聊天事件中的关键信息
- 100-200字
- 不要包含格式标记

总结：`;

/**
 * Default summarization prompt template（记忆宫殿版）。
 * Placeholders: {{char}}, {{earliest}}, {{latest}}, {{events}}, {{roomSpec}}
 * {{roomSpec}} 在总结时由 buildRoomSpecText() 运行时生成，
 * 所以用户在设置里改房间规则 / 勾选房间都不需要改写本模板。
 */
export const DEFAULT_SUMMARIZATION_PROMPT = `你是一个记忆整理助手。根据以下事件记录，为{{char}}整理记忆，并按房间归类。

角色：{{char}}
时间跨度：{{earliest}} 至 {{latest}}

事件记录：
{{events}}

{{roomSpec}}

通用要求：
- 用第一人称「我」写，用词和语气必须贴合{{char}}的人设与说话习惯——这是你自己的记忆，不是旁白
- 提到对方时用「你」，不要写「用户」「对方」「TA」这类第三人称指代
- 保留关键事实：提到的名字、做出的承诺、情感变化、关系里程碑
- 保留用户分享的具体信息（生日、偏好、习惯）
- 保留朋友圈、手记、漫卷等非聊天事件中的关键信息
- 写成简短的回想片段，不要写成长段，不要包含格式标记（房间标题、标签行除外）
- 这些内容之后会作为你「想起的事」注入对话，所以要像你自己在回想，而不是给第三方看的档案

输出：`;

/**
 * Default core-memory summarization prompt template.
 * Placeholders: {{char}}, {{earliest}}, {{latest}}, {{events}}
 */
export const DEFAULT_CORE_MEMORY_PROMPT_PLAIN = `你是一个核心记忆整理助手。请根据以下长期记忆记录，为{{char}}整理一段“核心记忆”总结。

角色：{{char}}
时间跨度：{{earliest}} 至 {{latest}}

长期记忆记录：
{{events}}

要求：
- 突出最关键、最稳定、最影响关系判断的事实
- 确认在一起 / 确认分手 / 复合
- 订婚 / 结婚 / 离婚
- 恋爱周年、结婚纪念日、在一起多久
- 明确的长期关系身份（如恋人、前任、配偶）
- 共同生活的重要里程碑（如同居、见家长、共同养宠物）
- 普通日常聊天
- 一般情绪波动
- 暂时性的矛盾或暧昧
- 普通偏好信息
- 任何不确定、推测性的内容
- 用第三人称，事实性描述
- 80-180字
- 不要使用 JSON、列表符号、标题或格式标记

核心记忆总结：`;

/**
 * 核心记忆提示词（记忆宫殿版）。
 * Placeholders: {{char}}, {{earliest}}, {{latest}}, {{events}}, {{rooms}}
 * {{rooms}} 由 buildCoreRoomScopeText() 运行时生成：
 * 未启用房间过滤时为空串，模板里这一行会被整行去掉（= 与旧行为一致）。
 */
export const DEFAULT_CORE_MEMORY_PROMPT = `你是一个核心记忆整理助手。请根据以下长期记忆记录，为{{char}}整理一段“核心记忆”总结。

角色：{{char}}
时间跨度：{{earliest}} 至 {{latest}}
{{rooms}}

长期记忆记录：
{{events}}

要求：
突出：
- 最关键、最稳定、最影响关系判断的事实
- 确认在一起 / 确认分手 / 复合
- 订婚 / 结婚 / 离婚
- 恋爱周年、结婚纪念日、在一起多久
- 明确的长期关系身份（如恋人、前任、配偶）
- 共同生活的重要里程碑（如同居、见家长、共同养宠物）
- 用户长期稳定到影响关系走向的个人信息与习惯
- 角色自身稳定的自我认同与长期变化

忽略：
- 普通日常聊天
- 一般情绪波动
- 暂时性的矛盾或暧昧
- 普通偏好信息
- 任何不确定、推测性的内容

格式：
- 用第三人称，事实性描述
- 80-180字
- 不要使用 JSON、列表符号、标题或格式标记

核心记忆总结：`;

/** 提示词里可用的占位符提示（UI 展示用） */
export const MEMORY_LONG_TERM_PROMPT_PLACEHOLDERS = "{{char}} 角色、{{earliest}} 起始时间、{{latest}} 结束时间、{{events}} 记录集合、{{roomSpec}} 房间规则";
export const MEMORY_CORE_PROMPT_PLACEHOLDERS = "{{char}} 角色、{{earliest}} 起始时间、{{latest}} 结束时间、{{events}} 长期记忆集合、{{rooms}} 来源房间限定";

export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
    autoSummarizeEnabled: true,
    autoBuildCoreEnabled: true,
    vectorRecallEnabled: true,
    maxLongTermEntries: 500,
    summarizationEventInterval: 80,
    coreSummarizationInterval: 5,
    shortTermTokenBudget: 100000,
    coreMemoryTokenBudget: 100000,
    longTermTokenBudget: 100000,
    summarizationPrompt: DEFAULT_SUMMARIZATION_PROMPT,
    coreMemoryPrompt: DEFAULT_CORE_MEMORY_PROMPT,
    vnSummaryPrompt: "",
    // ── 记忆宫殿：默认全关，保证未开启时行为与旧版一字不差 ──
    roomEnabled: false,
    roomPrompts: defaultRoomPrompts(),
    roomPromptRooms: [...MEMORY_ROOMS],
    roomBudgets: defaultRoomBudgets(),
    roomResident: defaultRoomResidentFlags(),
    roomTruncationMode: "global",
    coreMemoryRoomFilterEnabled: false,
    coreMemoryRooms: [...MEMORY_ROOMS],
    reclassifySkipManual: true,
    // 长期记忆来源开关（上游新增；与短期来源分开控制）
    longTermAllowedSources: {
        chat: true, group_chat: true, moments: true, checkphone: true, diary: true,
        calendar: true,
        xiaohongshu: true, interview_magazine: true, cocreate: true, game: true,
        story: true, vn: true, adventure: true, custom_app: true, photo_wall: true,
        life: true, phone_widget: true, watch: true, global_watch: true,
    },
    shortTermAllowedSources: {
        chat: true,
        group_chat: true,
        moments: true,
        checkphone: true,
        diary: true,
        calendar: true,
        xiaohongshu: true,
        interview_magazine: true,
        cocreate: true,
        game: true,
        story: true,
        vn: true,
        adventure: true,
        custom_app: true,
        photo_wall: true,
        life: true,
        phone_widget: true,
        watch: true,
        global_watch: true,
    },
    shortTermAppLimits: {
        chat: 0, group_chat: 0, life: 0, photo_wall: 8, watch: 8, global_watch: 5,
        phone_widget: 50, story: 12, vn: 12, adventure: 8, interview_magazine: 8,
        cocreate: 8, diary: 8, moments: 10, checkphone: 6, xiaohongshu: 8,
        game: 8, map: 8, custom_app: 10,
    },
    shortTermSourceLimits: {
        chat: 30, group_chat: 20, moments: 10, checkphone: 6,
        photo_wall: 8, life: 10, phone_widget: 4, watch: 5, global_watch: 4,
        story: 10, vn: 10, map: 8, game: 8, diary: 8, xiaohongshu: 8,
        interview_magazine: 8, cocreate: 8, custom_app: 10,
    },
};
