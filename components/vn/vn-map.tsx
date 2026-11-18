'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, MapPin, Plus, Trash2, Upload, X } from 'lucide-react';
import { addVnMap, deleteVnMap, loadVnMaps, saveVnMap, type VnMap, type VnMapPin } from '@/lib/vn-map-storage';
import { getThemeAssetDataUrl } from '@/lib/theme-storage';
import { loadVnScenes } from '@/lib/vn-asset-storage';

export function VnMapView({ characterId, editing = false, initialMapId, onChoose, onClose }: {
  characterId: string; editing?: boolean; initialMapId?: string; onChoose?: (scene: string) => void; onClose?: () => void;
}) {
  const [maps, setMaps] = useState(() => loadVnMaps(characterId));
  const initialSelection = (items: VnMap[]) => {
    if (initialMapId) return initialMapId;
    const roots = items.filter(map => !map.parentId || !items.some(parent => parent.id === map.parentId));
    return roots.length === 1 ? roots[0].id : null;
  };
  const [activeId, setActiveId] = useState<string | null>(() => initialSelection(maps));
  const [trail, setTrail] = useState<string[]>([]);
  const [image, setImage] = useState('');
  const [imageAspect, setImageAspect] = useState(9 / 16);
  const [pinId, setPinId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; moved: boolean; x: number; y: number } | null>(null);
  const active = maps.find(m => m.id === activeId);
  const pin = active?.pins.find(p => p.id === pinId);
  const scenes = useMemo(() => loadVnScenes(characterId), [characterId]);
  useEffect(() => { const items = loadVnMaps(characterId); setMaps(items); setActiveId(initialSelection(items)); setTrail([]); }, [characterId, initialMapId]);
  useEffect(() => {
    setImage(''); let cancelled = false;
    if (active) void getThemeAssetDataUrl(active.assetId).then(url => { if (!cancelled) setImage(url || ''); });
    return () => { cancelled = true; };
  }, [active?.assetId]);
  const update = (next: VnMap) => {
    try { saveVnMap(next); setMaps(loadVnMaps(characterId)); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : '保存失败'); }
  };
  const patchPin = (patch: Partial<VnMapPin>) => {
    if (active && pin) update({ ...active, pins: active.pins.map(p => p.id === pin.id ? { ...p, ...patch } : p) });
  };
  const enter = (id: string) => {
    if (activeId) setTrail(t => [...t, activeId]);
    setActiveId(id); setPinId(null);
  };
  const parentCandidates = maps.filter(candidate => {
    if (!active || candidate.characterId !== active.characterId) return false;
    let current: VnMap | undefined = candidate;
    const seen = new Set<string>();
    while (current && !seen.has(current.id)) {
      if (current.id === active.id) return false;
      seen.add(current.id);
      current = maps.find(item => item.id === current?.parentId);
    }
    return true;
  });
  const roots = maps.filter(m => !m.parentId || !maps.some(parent => parent.id === m.parentId));
  return <section className={`vn-map ${editing ? 'vn-map-editor' : 'vn-map-full'}`} onClick={e => e.stopPropagation()} aria-label={editing ? '地图资源' : '选择地点'}>
    <header className="vn-map-header">
      {!editing && <button type="button" aria-label="返回上级地图" disabled={!activeId} onClick={() => {
        setActiveId(trail.at(-1) ?? active?.parentId ?? null); setTrail(t => t.slice(0, -1)); setPinId(null);
      }}><ArrowLeft size={18}/></button>}
      <strong>{editing ? '编辑地图' : active?.name ?? '地点地图'}</strong>
      {onClose && <button type="button" onClick={onClose} aria-label="关闭地图"><X size={18}/></button>}
    </header>
    {error && <p role="alert">{error}</p>}
    {editing && <div className="vn-map-tools">
      {!initialMapId && <><input ref={file} type="file" accept="image/*" hidden onChange={async e => {
        const blob = e.target.files?.[0]; e.target.value = ''; if (!blob) return;
        setBusy(true);
        try { const m = await addVnMap(blob.name.replace(/\.[^.]+$/, ''), characterId, blob); setMaps(loadVnMaps(characterId)); setActiveId(m.id); setTrail([]); }
        catch { setError('图片上传失败，请重试'); } finally { setBusy(false); }
      }}/>
      <button type="button" disabled={busy} onClick={() => file.current?.click()}><Upload size={15}/>{busy ? '上传中…' : '上传地图'}</button>
      <select aria-label="编辑地图" value={activeId ?? ''} onChange={e => { setActiveId(e.target.value || null); setTrail([]); setPinId(null); }}>
        <option value="">选择地图</option>{maps.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>
      </>}
      {active && <button type="button" onClick={() => {
        const p: VnMapPin = { id: crypto.randomUUID(), name: '新地点', x: 50, y: 50 };
        update({ ...active, pins: [...active.pins, p] }); setPinId(p.id);
      }}><Plus size={15}/>添加地标</button>}
    </div>}
    {!active ? <div className="vn-map-list">
      {roots.map(m => <button type="button" key={m.id} onClick={() => enter(m.id)}><MapPin size={18}/>{m.name}</button>)}
      {!maps.length && <p>{editing ? '上传一张城市、校园或室内地图，再添加可拖动地标。' : '还没有地图。可在漫卷资源中上传，也可从下方选择已有场景。'}</p>}
      {!editing && !maps.length && scenes.map(scene => <button type="button" key={scene.id} onClick={() => onChoose?.(scene.name)}>{scene.name}</button>)}
    </div> : <>
      {editing && <div className="vn-map-tools">
        <label>地图名称<input value={active.name} onChange={e => update({ ...active, name: e.target.value })}/></label>
        <label>上层地图<select aria-label="上层地图" value={active.parentId ?? ''} onChange={e => update({ ...active, parentId: e.target.value || undefined })}>
          <option value="">无（根地图）</option>{parentCandidates.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select></label>
        <button type="button" onClick={async () => {
          if (!window.confirm(`删除地图「${active.name}」？子地图会保留。`)) return;
          try { await deleteVnMap(active.id); setMaps(loadVnMaps(characterId)); setActiveId(null); setTrail([]); }
          catch { setError('删除失败，请重试'); }
        }}><Trash2 size={15}/>删除地图</button>
      </div>}
      <div className="vn-map-viewport">
        <div className="vn-map-canvas" ref={canvas} style={editing ? { aspectRatio: imageAspect, width: `min(100%, ${340 * imageAspect}px)` } : undefined}>
          {image ? <img src={image} alt={active.name} draggable={false} onLoad={e => setImageAspect(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight || 9 / 16)}/> : <p>正在读取地图…</p>}
          {active.pins.map(p => <button type="button" key={p.id} className="vn-map-pin" data-selected={pinId === p.id || undefined}
            style={{ left: `${p.x}%`, top: `${p.y}%`, touchAction: editing ? 'none' : 'manipulation' }}
            onPointerDown={e => {
              if (!editing) return; setPinId(p.id); drag.current = { id: p.id, moved: false, x: e.clientX, y: e.clientY };
              e.currentTarget.setPointerCapture(e.pointerId);
            }} onPointerMove={e => {
              if (!editing || drag.current?.id !== p.id || !canvas.current) return;
              if (Math.hypot(e.clientX - drag.current.x, e.clientY - drag.current.y) < 4 && !drag.current.moved) return;
              drag.current.moved = true; const rect = canvas.current.getBoundingClientRect();
              const x = Math.max(2, Math.min(98, (e.clientX - rect.left) / rect.width * 100));
              const y = Math.max(2, Math.min(98, (e.clientY - rect.top) / rect.height * 100));
              setMaps(ms => ms.map(m => m.id === active.id ? { ...m, pins: m.pins.map(q => q.id === p.id ? { ...q, x, y } : q) } : m));
            }} onPointerUp={e => {
              if (editing && drag.current) { saveVnMap(active); drag.current = null; e.currentTarget.releasePointerCapture(e.pointerId); }
            }} onPointerCancel={() => { if (editing) { saveVnMap(active); drag.current = null; } }}
            onClick={() => {
              if (editing) { setPinId(p.id); return; }
              if (p.childMapId && maps.some(m => m.id === p.childMapId)) enter(p.childMapId);
              else if (p.sceneName) onChoose?.(p.sceneName);
              else setPinId(p.id);
            }}><MapPin size={editing ? 20 : 26}/><span>{p.name}{p.childMapId ? ' ›' : ''}</span></button>)}
        </div>
      </div>
      {!editing && pin && <div className="vn-map-tools"><strong>{pin.name}</strong>{pin.sceneName ? <button type="button" onClick={() => onChoose?.(pin.sceneName!)}>前往此处</button> : <span>该地标还没有关联场景</span>}</div>}
      {editing && <p className="vn-map-edit-hint">拖动地标调整位置，点击地标编辑关联。修改会自动保存。</p>}
      {editing && pin && <div className="vn-map-fields">
        <label>地点名称<input value={pin.name} onChange={e => patchPin({ name: e.target.value })}/></label>
        <label>关联场景<select aria-label="关联场景" value={pin.sceneName ?? ''} onChange={e => patchPin({ sceneName: e.target.value || undefined })}><option value="">不关联</option>{scenes.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}</select></label>
        <label>下层地图<select aria-label="下层地图" value={pin.childMapId ?? ''} onChange={e => patchPin({ childMapId: e.target.value || undefined })}><option value="">无</option>{maps.filter(m => m.parentId === active.id).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
        <button type="button" onClick={() => { update({ ...active, pins: active.pins.filter(p => p.id !== pin.id) }); setPinId(null); }}>删除地标</button>
      </div>}
    </>}
  </section>;
}
