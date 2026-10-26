"use client";

import { useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Settings2, X } from "lucide-react";
import { CustomStatusFrame } from "@/components/chat/custom-status-frame";
import {
  getVnStatusLayout,
  parseVnStatusRaw,
  saveVnStatusLayout,
  type VnStatusConfig,
} from "@/lib/vn-status-region";

const CARD_WIDTH = 232;

export function VnStatusFloat({
  characterId,
  config,
  raw,
  containerRef,
  onSettings,
  onHide,
}: {
  characterId: string;
  config: VnStatusConfig;
  raw: string;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onSettings: () => void;
  onHide: () => void;
}) {
  const [layout, setLayout] = useState(() => getVnStatusLayout(characterId));
  const dragRef = useRef<{ startX: number; startY: number; x: number; y: number } | null>(null);
  const parsed = useMemo(() => parseVnStatusRaw(raw), [raw]);
  const custom = config.mode === "custom" && config.renderHtml.trim().length > 0;
  const bars = parsed.fields.filter(field => field.kind === "bar");
  const chips = parsed.fields.filter(field => field.kind === "text" && field.key !== "天气");

  const persist = (next: typeof layout) => {
    setLayout(next);
    saveVnStatusLayout(characterId, next);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      x: layout.x,
      y: layout.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const container = containerRef.current;
    if (!drag || !container) return;
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    setLayout(current => ({
      ...current,
      x: Math.max(0, Math.min(100, drag.x + ((event.clientX - drag.startX) / width) * 100)),
      y: Math.max(0, Math.min(80, drag.y + ((event.clientY - drag.startY) / height) * 100)),
    }));
  };

  const onPointerUp = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setLayout(current => {
      saveVnStatusLayout(characterId, current);
      return current;
    });
  };

  return (
    <section
      className="vn-status-float"
      data-custom={custom ? "true" : undefined}
      data-collapsed={layout.collapsed ? "true" : undefined}
      style={{
        left: `calc(${layout.x}% - ${(layout.x / 100) * CARD_WIDTH}px)`,
        top: `calc(var(--page-header-safe-top, 48px) + 58px + ${layout.y}%)`,
      }}
      onClick={event => event.stopPropagation()}
      onPointerDown={event => event.stopPropagation()}
    >
      <header
        className="vn-status-float-bar"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <span className="vn-status-float-kicker">STATUS</span>
        <span className="vn-status-float-weather">{parsed.values["天气"] || ""}</span>
        <span className="vn-status-float-actions">
          <button type="button" onPointerDown={event => event.stopPropagation()} onClick={onSettings} aria-label="状态浮窗设置" title="设置">
            <Settings2 size={12} />
          </button>
          <button
            type="button"
            onPointerDown={event => event.stopPropagation()}
            onClick={() => persist({ ...layout, collapsed: !layout.collapsed })}
            aria-label={layout.collapsed ? "展开状态" : "收起状态"}
            title={layout.collapsed ? "展开" : "收起"}
          >
            {layout.collapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
          </button>
          <button type="button" onPointerDown={event => event.stopPropagation()} onClick={onHide} aria-label="隐藏状态" title="隐藏">
            <X size={12} />
          </button>
        </span>
      </header>

      {!layout.collapsed ? (
        <div className="vn-status-float-body">
          {custom ? (
            <CustomStatusFrame
              html={config.renderHtml}
              raw={raw}
              css={config.css}
              title="漫卷状态"
            />
          ) : (
            <div className="vn-status-native">
              {bars.length > 0 ? (
                <div className="vn-status-bars">
                  {bars.map(field => (
                    <div className="vn-status-bar-row" key={field.key}>
                      <span>{field.key}</span>
                      <i><b style={{ width: `${field.numeric ?? 0}%` }} /></i>
                      <em>{Math.round(field.numeric ?? 0)}</em>
                    </div>
                  ))}
                </div>
              ) : null}
              {chips.length > 0 ? (
                <div className="vn-status-chips">
                  {chips.map(field => (
                    <span key={field.key}>{field.key.replace("状态", "")} · {field.value}</span>
                  ))}
                </div>
              ) : null}
              {parsed.inner ? <p className="vn-status-inner">“{parsed.inner}”</p> : null}
              {!bars.length && !chips.length && !parsed.inner ? (
                <p className="vn-status-empty">等待状态</p>
              ) : null}
            </div>
          )}
        </div>
      ) : (
        <div className="vn-status-collapsed">
          <span>{bars[0]?.key || "好感度"} {bars[0]?.numeric != null ? Math.round(bars[0].numeric) : "--"}</span>
          <em>{parsed.values["心情"] || parsed.values["天气"] || "状态"}</em>
        </div>
      )}
    </section>
  );
}
