import { kvGet, kvSet, registerKvMigration } from './kv-db';
const KEY = 'ai_phone_vn_generation_preferences_v1';
registerKvMigration(KEY);

export type VnGenerationPreferences = { style: string; minWords: number; maxWords: number; customPrompt: string };
export function loadVnGenerationPreferences(characterId: string): VnGenerationPreferences {
  try { return { style: '', minWords: 0, maxWords: 0, customPrompt: '', ...(JSON.parse(kvGet(KEY) || '{}')[characterId] ?? {}) }; }
  catch { return { style: '', minWords: 0, maxWords: 0, customPrompt: '' }; }
}
export function saveVnGenerationPreferences(characterId: string, prefs: VnGenerationPreferences): void {
  let all: Record<string, VnGenerationPreferences> = {};
  try { all = JSON.parse(kvGet(KEY) || '{}'); } catch {}
  kvSet(KEY, JSON.stringify({ ...all, [characterId]: prefs }));
}
export function buildVnGenerationInstruction(characterId: string): string {
  const p = loadVnGenerationPreferences(characterId);
  return [p.style && `文风：${p.style}`, (p.minWords || p.maxWords) && `本轮正文目标字数：${p.minWords || '不限下限'}至${p.maxWords || '不限上限'}字。`, p.customPrompt]
    .filter(Boolean).join('\n');
}
