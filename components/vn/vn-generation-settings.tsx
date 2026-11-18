'use client';
import { useState } from 'react';
import { X } from 'lucide-react';
import { loadVnGenerationPreferences, saveVnGenerationPreferences } from '@/lib/vn-generation-preferences';
export function VnGenerationSettings({ characterId, onClose, onStatus }: { characterId: string; onClose: () => void; onStatus: () => void }) {
  const [prefs, setPrefs] = useState(() => loadVnGenerationPreferences(characterId));
  const [error, setError] = useState('');
  return <div className="vn-history-overlay" onClick={onClose}><section className="vn-tool-panel" role="dialog" aria-modal="true" aria-label="漫卷设置" onClick={e => e.stopPropagation()}>
    <header><h2>漫卷设置</h2><button type="button" aria-label="关闭设置" onClick={onClose}><X size={18}/></button></header>
    <h3>生成偏好</h3>
    <label>文风<input value={prefs.style} placeholder="例如：克制、细腻，少用比喻" onChange={e => setPrefs({ ...prefs, style: e.target.value })}/></label>
    <div className="vn-tool-row"><label>最少字数<input type="number" min={0} max={20000} value={prefs.minWords} onChange={e => setPrefs({ ...prefs, minWords: Math.max(0, Math.min(20000, Number(e.target.value))) })}/></label>
    <label>最多字数<input type="number" min={0} max={20000} value={prefs.maxWords} onChange={e => setPrefs({ ...prefs, maxWords: Math.max(0, Math.min(20000, Number(e.target.value))) })}/></label></div>
    <p>填 0 表示不额外限制。字数是生成目标，不会截断结果。</p>
    <label>持续生效的要求<textarea rows={4} value={prefs.customPrompt} onChange={e => setPrefs({ ...prefs, customPrompt: e.target.value })}/></label>
    {error && <p role="alert">{error}</p>}
    <button type="button" onClick={() => { if (prefs.maxWords && prefs.minWords > prefs.maxWords) { setError('最多字数不能小于最少字数'); return; } saveVnGenerationPreferences(characterId, prefs); onClose(); }}>保存生成偏好</button>
    <button type="button" onClick={onStatus}>状态展示设置</button>
  </section></div>;
}
