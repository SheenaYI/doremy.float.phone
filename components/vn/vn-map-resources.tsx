'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, Expand, MapPin, Pencil } from 'lucide-react';
import { addVnMap, loadVnMaps, type VnMap } from '@/lib/vn-map-storage';
import { getThemeAssetDataUrl } from '@/lib/theme-storage';
import { loadVnConfig } from '@/lib/vn-storage';
import { VnMapView } from './vn-map';

export function getVnMapDepth(map: VnMap, maps: VnMap[]): number {
  let depth = 1;
  let parent = map.parentId;
  const seen = new Set([map.id]);
  while (parent && !seen.has(parent)) {
    const upper = maps.find(item => item.id === parent);
    if (!upper) break;
    seen.add(parent);
    depth += 1;
    parent = upper.parentId;
  }
  return depth;
}

function MapThumbnail({ map }: { map: VnMap }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [image, setImage] = useState('');
  useEffect(() => {
    let stopped = false;
    const load = () => { void getThemeAssetDataUrl(map.assetId).then(url => { if (!stopped) setImage(url || ''); }).catch(() => {}); };
    if (!ref.current || typeof IntersectionObserver === 'undefined') { load(); return () => { stopped = true; }; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); load(); }
    });
    observer.observe(ref.current);
    return () => { stopped = true; observer.disconnect(); };
  }, [map.assetId]);
  return <span className="vn-map-thumbnail" ref={ref}>{image ? <img src={image} alt=""/> : <MapPin size={20}/>}</span>;
}

export function VnMapResources({ characterId, fileRef }: { characterId: string; fileRef: RefObject<HTMLInputElement | null> }) {
  const [maps, setMaps] = useState(() => loadVnMaps(characterId));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [fullPreview, setFullPreview] = useState(false);
  const [previewScene, setPreviewScene] = useState('');
  useEffect(() => {
    if (!editingId && !fullPreview) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('.vn-resource-dialog');
    dialog?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setEditingId(null); setFullPreview(false);
        setMaps(loadVnMaps(characterId)); setRevision(value => value + 1);
      }
      if (event.key !== 'Tab' || !dialog) return;
      const controls = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not([hidden]), select, textarea')];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', handleKey);
    return () => { document.removeEventListener('keydown', handleKey); if (previous?.isConnected) previous.focus(); };
  }, [editingId, fullPreview, characterId]);
  const grouped = new Map<number, VnMap[]>();
  for (const map of maps) {
    const depth = getVnMapDepth(map, maps);
    grouped.set(depth, [...(grouped.get(depth) || []), map]);
  }
  if (!grouped.size) grouped.set(1, []);
  const levelName = (depth: number) => `${['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'][depth - 1] ?? depth}级地图`;
  const finishEditing = () => { setEditingId(null); setMaps(loadVnMaps(characterId)); setRevision(value => value + 1); };

  return <div className="vn-map-resources">
    <input ref={fileRef} type="file" accept="image/*" hidden disabled={busy} onChange={async event => {
      const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
      setBusy(true); setError('');
      try {
        const map = await addVnMap(file.name.replace(/\.[^.]+$/, ''), characterId, file);
        setMaps(loadVnMaps(characterId)); setEditingId(map.id);
      } catch { setError('地图上传失败，请重试'); } finally { setBusy(false); }
    }}/>
    <p className="vn-resource-caption">地图逐层展开，例如：城市 → 校园 → 教学楼内部。</p>
    {busy && <p role="status">正在保存地图…</p>}
    {error && <p role="alert">{error}</p>}
    {[...grouped.entries()].sort(([a], [b]) => a - b).map(([depth, items]) => <section className="vn-map-level" key={depth}>
      <header><h3>{levelName(depth)}{depth === 1 ? ' · 根地图' : ''}</h3><span>{items.length} 张</span></header>
      <p className="vn-resource-caption">{depth === 1 ? '从这里开始探索，未设置上层地图。' : `从${levelName(depth - 1)}的地标进入，继续向内探索。`}</p>
      <div className="vn-map-resource-list">
        {items.map(map => <button type="button" className="vn-map-resource-row" key={map.id} onClick={() => setEditingId(map.id)} aria-label={`编辑地图 ${map.name}`}>
          <MapThumbnail map={map}/>
          <span className="vn-map-resource-copy"><strong>{map.name}</strong><span>{map.parentId ? `上层：${maps.find(item => item.id === map.parentId)?.name || '未找到'}` : '根地图'} · {map.pins.length} 个地标</span></span>
          <Pencil size={14}/>
        </button>)}
        {!items.length && <div className="vn-map-resource-empty"><MapPin size={22}/><span>点击上方“新增地图”，上传第一张地图。</span></div>}
      </div>
    </section>)}
    <section className="vn-map-preview-section">
      <header><h3>漫卷效果预览</h3><button type="button" disabled={!maps.length} onClick={() => setFullPreview(true)}><Expand size={14}/>全屏预览</button></header>
      <p className="vn-resource-caption">点击地标可进入下层地图，或选择关联场景。</p>
      <div className="vn-map-preview" data-vn-theme={loadVnConfig("theme") || "default"} key={revision}><VnMapView characterId={characterId} onChoose={setPreviewScene}/></div>
      {previewScene && <p className="vn-map-preview-result"><MapPin size={13}/>{previewScene}<ChevronRight size={13}/><span>已选择场景</span></p>}
    </section>
    {editingId && createPortal(<div className="vn-resource-overlay" onClick={finishEditing}>
      <section className="vn-resource-dialog" role="dialog" aria-modal="true" aria-label="编辑地图资源" onClick={event => event.stopPropagation()}>
        <div className="vn-resource-dialog-body"><VnMapView key={editingId} characterId={characterId} initialMapId={editingId} editing onClose={finishEditing}/></div>
        <footer><span>关闭后可在下方预览效果</span><button type="button" className="vn-editor-primary" onClick={finishEditing}>完成编辑</button></footer>
      </section>
    </div>, document.body)}
    {fullPreview && createPortal(<div className="vn-resource-overlay">
      <section className="vn-resource-dialog vn-resource-preview-dialog" data-vn-theme={loadVnConfig("theme") || "default"} role="dialog" aria-modal="true" aria-label="漫卷地图预览">
        <VnMapView characterId={characterId} onChoose={scene => { setPreviewScene(scene); setFullPreview(false); }} onClose={() => setFullPreview(false)}/>
      </section>
    </div>, document.body)}
  </div>;
}
