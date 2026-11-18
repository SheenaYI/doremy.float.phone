'use client';
import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { loadVnMessagesForChapter, saveVnMessageRevision } from '@/lib/vn-storage';
import { generateVnCompletion } from '@/lib/vn-engine';
import { parseVnResponse } from '@/lib/vn-parser';
import type { VnVariant } from '@/lib/vn-types';
export function VnRoundReview({ characterId, sessionId, chapterIndex, onClose, onAdopt }: {
  characterId: string; sessionId: string; chapterIndex: number; onClose: () => void; onAdopt: () => void;
}) {
  const messages = loadVnMessagesForChapter(sessionId, chapterIndex);
  const target = [...messages].reverse().find(m => m.role === 'assistant');
  const original: VnVariant | undefined = target ? { id: target.id, rawContent: target.rawContent, roundSummary: target.roundSummary, statusRaw: target.statusRaw, createdAt: target.createdAt } : undefined;
  const [versions, setVersions] = useState<VnVariant[]>(target?.variants?.length ? target.variants : original ? [original] : []);
  const [selected, setSelected] = useState(target?.selectedVariantId ?? original?.id);
  const [adopted, setAdopted] = useState(target?.selectedVariantId ?? original?.id);
  const [director, setDirector] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const version = versions.find(v => v.id === selected);
  const parsed = useMemo(() => version ? parseVnResponse(version.rawContent) : null, [version]);
  const latest = target && messages[messages.length - 1]?.id === target.id;
  return <div className="vn-history-overlay" onClick={() => { if (!busy) onClose(); }}><section className="vn-tool-panel vn-round-review" role="dialog" aria-modal="true" aria-label="本轮回顾" onClick={e => e.stopPropagation()}>
    <header><h2>本轮回顾</h2><button type="button" disabled={busy} onClick={onClose} aria-label="关闭本轮回顾"><X size={18}/></button></header>
    {!target ? <p>本章还没有生成内容。</p> : <>
      <nav aria-label="生成版本">{versions.map((v, i) => <button type="button" disabled={busy} key={v.id} aria-pressed={selected === v.id} onClick={() => setSelected(v.id)}>版本 {i + 1}{v.id === adopted ? ' · 已采用' : ''}</button>)}</nav>
      <div className="vn-round-bubbles">{parsed?.frames.filter(f => f.text).map((f, i) => <article className={f.speaker ? 'vn-round-bubble' : 'vn-round-narration'} key={i}>{f.speaker && <strong>{f.speaker}</strong>}<p>{f.text}</p></article>)}</div>
      <details><summary>本轮选项、状态与摘要</summary><pre>{JSON.stringify(parsed?.options ?? null, null, 2)}</pre><p>{version?.statusRaw || '无状态'}</p><p>{version?.roundSummary || '无摘要'}</p></details>
      <label>导演台 · 本次重生成方向<textarea rows={3} value={director} onChange={e => setDirector(e.target.value)} placeholder="例如：减少旁白，先回应刚才的问题，不要推进到第二天。"/></label>
      {error && <p role="alert">{error}</p>}
      {!latest && <p>这一轮已有后续输入。请在章节历史中管理分支；此处保留查看。</p>}
      {target.memoryCommitted && <p>这一轮已进入记忆，当前仅供查看。</p>}
      <div className="vn-tool-row">
        <button type="button" disabled={busy || !latest || target.memoryCommitted} onClick={async () => {
          setBusy(true); setError('');
          try {
            const history = messages.slice(0, messages.findIndex(m => m.id === target.id));
            const result = await generateVnCompletion(characterId, history, { chapterIndex, directorPrompt: director });
            const next: VnVariant = { id: crypto.randomUUID(), rawContent: result.rawText, roundSummary: result.summaryText, statusRaw: result.statusText, directorPrompt: director, createdAt: new Date().toISOString() };
            const all = [...versions, next]; await saveVnMessageRevision(target.id, { variants: all }); setVersions(all); setSelected(next.id);
          } catch (e) { setError(e instanceof Error ? e.message : '重新生成失败，原版本已保留'); }
          finally { setBusy(false); }
        }}>{busy ? '生成中…' : '重新生成'}</button>
        <button type="button" disabled={busy || !latest || target.memoryCommitted || !version || selected === adopted} onClick={async () => {
          if (!version) return; setBusy(true); setError('');
          try { await saveVnMessageRevision(target.id, { rawContent: version.rawContent, roundSummary: version.roundSummary, statusRaw: version.statusRaw, frameAudio: undefined, variants: versions, selectedVariantId: version.id }); setAdopted(version.id); onAdopt(); }
          catch { setError('采用失败，请重试'); } finally { setBusy(false); }
        }}>采用此版本</button>
      </div>
    </>}
  </section></div>;
}
