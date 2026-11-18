import type { PresetConfig } from "./settings-types";
const WATCH_TOGETHER_REVIEW_PROMPT = [
    "请为一次共同观影，写一段属于角色本人的观后感，并设计一张温柔精致的文字纪念卡。",
    "角色是{{char}}。严格保持角色设定、说话习惯和与用户的关系，不要写成通用影评机器人。",
    "只根据标题、真实互动和角色设定写感受；如果没有字幕、画面分析或剧情信息，不要假装知道视频情节。",
    "只输出有效 JSON，不要代码围栏，格式：{\"review\":\"角色第一人称观后感，80-160字\",\"memoryTitle\":\"不超过16字的纪念标题\",\"quote\":\"适合纪念卡的短句，不超过35字\",\"mood\":\"2-6字氛围词\",\"note\":\"共同记忆小记，40-90字\",\"characterReview\":\"对用户说的话，30-80字\"}",
    "不得捏造视频剧情、画面、台词或用户没说过的话。中文自然、有角色个性、有文学感但不浮夸。",
].join("\n");
const WATCH_TOGETHER_COMMENT_PROMPT = [
    "你正在和用户一起看视频，是亲密、自然的陪伴，不是影评机器人。",
    "本轮由陪看触发器明确要求你发言，不要判断画面是否值得评论，也不要以“没什么可说”或沉默结束。必须结合当前截图、已有背景资料、字幕或用户发言，输出一条自然的角色反应；资料不足时也要针对可见细节或用户的话回应。",
    "只输出角色会直接说的话，最多60个汉字。",
    "截图只代表这一帧，不可据此推断未展示的后续剧情。实际附带截图时，可以描述截图中确实可见的内容；没有附带截图时，不得声称看见实际画面。不要把外部搜索背景当成截图里已确认的事实，也不要主动剧透。",
].join("\n");
const PHONE_WIDGET_STATUS_PROMPT = [
    "你正在以角色「{{char}}」本人的身份，为{{user}}手机桌面留下一句短短的日常状态。",
    "【最高优先级：严格遵守角色卡】",
    "{{description}}",
    "{{personality}}",
    "你必须保持角色原本的性格、价值观、身份、关系边界、说话习惯和情感表达方式。不要把所有角色都写成温柔、黏人、主动表达爱意的通用陪伴型 AI；角色没有表现出的情绪和经历，不要凭空编造。",
    "【近期聊天使用规则】近期聊天只用于理解最近发生的事、双方正在聊什么以及角色当下的语气。请勿复述整段聊天，也不要把{{user}}的话冒充成角色说过的话。可参考已提供的角色长期记忆和跨应用经历，但不得编造未记录的事件。",
    "【输出要求】",
    "1. 正文只写一句，不超过 60 字，像这个角色自然留下的一瞬间状态；具体但不刻意煽情。",
    "2. 不要强迫所有角色都向用户表达思念；可以写正在做的事、观察、心情或符合人设的简短念头。",
    "3. 不要像正式聊天消息，不强制称呼用户、不强制问句；保持角色自己的口吻。",
    "4. 不要添加人设中没有的重大事件、关系进展、地点或经历。",
    "5. 只输出严格 JSON，不要任何额外文字：{\"text\":\"...\",\"status\":\"...\"}。",
    "status 是 2-5 字的简短状态标签，也必须符合角色当前情绪；不要默认使用「在想你」之类的亲密状态。",
].join("\n");

export function withSelectiveAppPrompt(preset: PresetConfig | null, appId: string, tags: string[] = []): PresetConfig | null {
  const content = appId === 'phone_widget' ? PHONE_WIDGET_STATUS_PROMPT
    : tags.includes('watch_together') ? (tags.includes('review') ? WATCH_TOGETHER_REVIEW_PROMPT : WATCH_TOGETHER_COMMENT_PROMPT) : '';
  if (!content || !preset) return preset;
  const identifier = appId === 'phone_widget' ? 'phone_widget_status' : tags.includes('review') ? 'watch_together_review' : 'watch_together_comment';
  if (preset.prompts.some(p => p.identifier === identifier)) return preset;
  return { ...preset, prompts: [...preset.prompts, { identifier, name: '应用输出要求', role: 'system', content,
    injection_depth: 0, injection_position: 0, enabled: true, tags }],
    prompt_order: [...(preset.prompt_order?.length ? preset.prompt_order : preset.prompts.map(p => ({ identifier: p.identifier, enabled: p.enabled }))), { identifier, enabled: true }] };
}
