'use client';
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Settings2 } from 'lucide-react';
import { CustomStatusFrame } from '@/components/chat/custom-status-frame';
import { parseVnStatusRaw, type VnStatusConfig } from '@/lib/vn-status-region';
export function VnStatusFloat({ config, raw, onSettings }: {
  characterId: string; config: VnStatusConfig; raw: string;
  containerRef: React.RefObject<HTMLDivElement | null>; onSettings: () => void; onHide: () => void;
}) {
  const [open, setOpen] = useState(false);
  const parsed = useMemo(() => parseVnStatusRaw(raw), [raw]);
  return <section className="vn-status-drawer" onClick={e => e.stopPropagation()}>
    <div className="vn-status-drawer-heading"><button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
      <span>状态{parsed.values['天气'] ? ` · ${parsed.values['天气']}` : ''}</span>{open ? <ChevronDown size={14}/> : <ChevronUp size={14}/>}
    </button><button type="button" onClick={onSettings} aria-label="状态设置"><Settings2 size={14}/></button></div>
    {open && <div className="vn-status-drawer-body">
      {config.mode === 'custom' && config.renderHtml.trim() ? <CustomStatusFrame html={config.renderHtml} raw={raw} css={config.css}/> : <>
        {parsed.fields.map(field => <div className="vn-status-drawer-field" key={field.key}><strong>{field.key}</strong><span>{field.value}</span>{field.kind === 'bar' && <progress max={100} value={field.numeric ?? 0}/>}</div>)}
        {parsed.inner && <p>{parsed.inner}</p>}{!parsed.fields.length && !parsed.inner && <p>等待状态更新</p>}
      </>}
    </div>}
  </section>;
}
