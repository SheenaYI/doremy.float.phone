'use client';
import { useState } from 'react';
import { ChevronRight, Settings2, X } from 'lucide-react';
import { loadVnGenerationPreferences, saveVnGenerationPreferences } from '@/lib/vn-generation-preferences';
export function VnGenerationSettings({ characterId, onClose, onStatus, inactive = false }: { characterId: string; onClose: () => void; onStatus: () => void; inactive?: boolean }) {
  const [prefs, setPrefs] = useState(() => loadVnGenerationPreferences(characterId));
  const [error, setError] = useState('');
  return <div className="vn-preferences-overlay" inert={inactive} aria-hidden={inactive || undefined} onClick={onClose}><section className="vn-preferences" role="dialog" aria-modal={inactive ? undefined : true} aria-label="漫卷设置" onClick={e => e.stopPropagation()}>
    <header><div><h2>漫卷设置</h2><p>只调整当前角色的漫卷生成偏好</p></div><button type="button" aria-label="关闭设置" onClick={onClose}><X size={18}/></button></header>
    <div className="vn-preferences-scroll">
    <section className="vn-preferences-group"><h3>文风与字数</h3>
    <label>文风<input value={prefs.style} placeholder="例如：克制、细腻，少用比喻" onChange={e => setPrefs({ ...prefs, style: e.target.value })}/></label>
    <div className="vn-tool-row"><label>最少字数<input type="number" min={0} max={20000} value={prefs.minWords} onChange={e => setPrefs({ ...prefs, minWords: Math.max(0, Math.min(20000, Number(e.target.value))) })}/></label>
    <label>最多字数<input type="number" min={0} max={20000} value={prefs.maxWords} onChange={e => setPrefs({ ...prefs, maxWords: Math.max(0, Math.min(20000, Number(e.target.value))) })}/></label></div>
    <p>填 0 表示不额外限制。字数是生成目标，不会截断结果。</p>
    </section>
    <section className="vn-preferences-group"><h3>额外生成要求</h3><label>持续生效的要求<textarea rows={5} value={prefs.customPrompt} placeholder="例如：增加角色对话，减少重复的动作描写。" onChange={e => setPrefs({ ...prefs, customPrompt: e.target.value })}/></label></section>
    <section className="vn-preferences-group"><h3>状态展示</h3><button type="button" className="vn-preferences-link" onClick={onStatus}><Settings2 size={16}/><span>状态抽屉设置<small>显示方式、状态字段与自定义样式</small></span><ChevronRight size={16}/></button></section>
    </div>
    <footer>{error && <p role="alert">{error}</p>}<button type="button" onClick={onClose}>取消</button><button type="button" className="vn-preferences-save" onClick={() => { if (prefs.maxWords && prefs.minWords > prefs.maxWords) { setError('最多字数不能小于最少字数'); return; } saveVnGenerationPreferences(characterId, prefs); onClose(); }}>保存生成偏好</button></footer>
  </section></div>;
}
