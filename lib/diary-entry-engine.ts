import { loadCharacters } from "./character-storage";
import type { Character } from "./character-types";
import { previewMessagesForApi, sendLLMRequest, ChatEngineError } from "./chat-engine";
import { assemblePromptPayload, type LLMMessage } from "./llm-prompt-assembler";
import { loadBindingConfig, loadApiConfigs, loadPresets, loadWorldBooks, loadRegexes, resolveBinding, resolveUserIdentity } from "./settings-storage";
import type { ApiConfig, PresetConfig, RegexConfig, WorldBookConfig } from "./settings-types";
import { loadMemoryConfig } from "./memory-storage";
import { retrieveCoreMemoriesForPrompt, retrieveMemoriesForPrompt } from "./memory-service";
import { formatCoreMemories, formatLongTermMemories } from "./memory-injector";
import { prepareShortTermContext } from "./short-term-assembler";
import { formatDiaryEntryContext, parseDiaryEntryContent, type ParsedDiaryEntry } from "./diary-entry-utils";
import type { DiaryEntry, DiaryEntryTrigger } from "./diary-entry-types";
import { beginDiaryGeneration, endDiaryGeneration } from "./diary-generating-tracker";

const DIARY_RICH_MEDIA_INSTRUCTION = [
  "【手记排版补充指令】",
  "输出 blocks 时不要所有内容都用 paragraph。",
  "根据内容自然使用至少 2 种 block 类型：paragraph / quote / highlight / bold / italic / ul / ol / correction / todo / image。",
  "例如：普通叙述用 paragraph；一句想记住的话用 highlight；清单用 ul/ol；涂改用 correction；待办用 todo；贴纸描述用 image。",
  "不要为了形式硬塞，也不要输出 Markdown、HTML 或 CSS。",
  "仍然只输出一个 JSON 对象，格式：",
  '{"title":"标题","mood":"心情","weather":"天气","tags":["标签"],"body":"完整正文","blocks":[{"type":"paragraph","text":"段落"},{"type":"highlight","text":"高亮句"},{"type":"ul","title":"清单","items":["一项"]},{"type":"todo","title":"待办","items":[{"text":"事项","done":false}]}]}',
  "blocks 最多 8 个；正文必须能从 blocks 中读出来。",
].join("\n");

type ResolvedDiaryEntryGeneration = {
  character: Character;
  apiConfig: ApiConfig;
  preset: PresetConfig | null;
  regexes: RegexConfig[];
  messages: LLMMessage[];
  userName: string;
};

async function resolveDiaryEntryGeneration(
  characterId: string,
  entries: DiaryEntry[],
): Promise<ResolvedDiaryEntryGeneration> {
  const character = loadCharacters().find(entry => entry.id === characterId);
  if (!character) throw new ChatEngineError("找不到要写日记的角色。");

  const bindings = loadBindingConfig();
  const slot = resolveBinding(bindings, character.id, "diary");
  if (!slot.apiConfigId) {
    throw new ChatEngineError(`未给「日记」绑定 ${character.name} 的 API 配置。`);
  }

  const apiConfig = loadApiConfigs().find(entry => entry.id === slot.apiConfigId);
  if (!apiConfig) throw new ChatEngineError(`找不到 ${character.name} 的 API 配置。`);

  const presets = loadPresets();
  let preset = slot.presetId ? presets.find(entry => entry.id === slot.presetId) ?? null : null;
  if (!preset) preset = presets.find(entry => entry.builtIn) ?? null;

  const allWorldBooks = loadWorldBooks();
  const worldBooks = (slot.worldBookIds || [])
    .map(id => allWorldBooks.find(entry => entry.id === id))
    .filter(Boolean) as WorldBookConfig[];

  const allRegexes = loadRegexes();
  const regexes = (slot.regexIds || [])
    .map(id => allRegexes.find(entry => entry.id === id))
    .filter(Boolean) as RegexConfig[];

  const userIdentity = resolveUserIdentity(character.id, "diary");
  const userName = userIdentity?.name ?? "用户";
  const memConfig = loadMemoryConfig();
  const prepared = prepareShortTermContext(character.id, "diary", { history: [] });

  const [memories, coreMemories] = await Promise.all([
    retrieveMemoriesForPrompt(character.id, prepared.wbActivationContext, memConfig).catch(() => []),
    retrieveCoreMemoriesForPrompt(character.id, memConfig).catch(() => []),
  ]);

  const messages = assemblePromptPayload({
    character,
    history: [],
    preset,
    worldBooks,
    regexes,
    userIdentity,
    appId: "diary",
    appTags: ["diary", "entries"],
    longTermMemories: formatLongTermMemories(memories),
    coreMemories: formatCoreMemories(coreMemories),
    worldBookActivationContext: prepared.wbActivationContext,
    recentBlocks: prepared.recentBlocks,
    unifiedRecentItems: prepared.unifiedRecentItems,
    diaryEntryContext: formatDiaryEntryContext(entries),
  });

  return { character, apiConfig, preset, regexes, messages, userName };
}

export async function generateDiaryEntryForCharacter(
  characterId: string,
  entries: DiaryEntry[],
  _trigger: DiaryEntryTrigger = "manual",
): Promise<ParsedDiaryEntry> {
  // Tracked at the engine so every caller (manual + background timer) shows up
  // in the diary app's "generating" indicator, even across app re-entry.
  beginDiaryGeneration(characterId);
  try {
    const resolved = await resolveDiaryEntryGeneration(characterId, entries);
    const raw = await sendLLMRequest(
      resolved.apiConfig,
      resolved.preset,
      [...resolved.messages, { role: "system", content: DIARY_RICH_MEDIA_INSTRUCTION }],
      resolved.regexes,
      { characterName: `日记:${resolved.character.name}`, userName: resolved.userName },
      { appId: "diary", appTags: ["diary", "entries"] },
    );
    return parseDiaryEntryContent(raw);
  } finally {
    endDiaryGeneration(characterId);
  }
}

export async function previewDiaryEntryPromptPayload(
  characterId: string,
  entries: DiaryEntry[],
): Promise<{ messages: LLMMessage[]; characterName: string; model: string; presetName: string }> {
  const resolved = await resolveDiaryEntryGeneration(characterId, entries);
  return {
    messages: previewMessagesForApi(resolved.apiConfig, resolved.preset, [
      ...resolved.messages,
      { role: "system", content: DIARY_RICH_MEDIA_INSTRUCTION },
    ]),
    characterName: `日记:${resolved.character.name}`,
    model: resolved.apiConfig.defaultModel,
    presetName: resolved.preset?.name ?? "默认预设",
  };
}
