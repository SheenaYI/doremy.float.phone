'use client';
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Settings2 } from 'lucide-react';
import { CustomStatusFrame } from '@/components/chat/custom-status-frame';
import { isVnStatusActive, parseVnStatusRaw, type VnStatusConfig } from '@/lib/vn-status-region';
export function VnStatusFloat({ config, raw, onSettings }: {
  characterId: string; config: VnStatusConfig; raw: string;
  containerRef: React.RefObject<HTMLDivElement | null>; onSettings: () => void;
}) {
  const [open, setOpen] = useState(false);
  const active = isVnStatusActive(config);
  const parsed = useMemo(() => parseVnStatusRaw(raw), [raw]);
  return <section className="vn-status-drawer" onClick={e => e.stopPropagation()}>
    <div className="vn-status-drawer-heading"><button type="button" aria-expanded={active && open} onClick={() => active ? setOpen(!open) : onSettings()}>
      <span>状态{!active ? ' · 未启用' : parsed.values['天气'] ? ` · ${parsed.values['天气']}` : ''}</span>{active && open ? <ChevronDown size={14}/> : <ChevronUp size={14}/>}
    </button><button type="button" onClick={onSettings} aria-label="状态设置"><Settings2 size={14}/></button></div>
    {active && open && <div className="vn-status-drawer-body">
      {config.mode === 'custom' && config.renderHtml.trim() ? <CustomStatusFrame html={config.renderHtml} raw={raw} css={config.css}/> : <>
        {parsed.fields.map(field => <div className="vn-status-drawer-field" key={field.key}><strong>{field.key}</strong><span>{field.value}</span>{field.kind === 'bar' && <progress max={100} value={field.numeric ?? 0}/>}</div>)}
        {parsed.inner && <p>{parsed.inner}</p>}{!parsed.fields.length && !parsed.inner && <p>等待状态更新</p>}
      </>}
    </div>}
  </section>;
}
