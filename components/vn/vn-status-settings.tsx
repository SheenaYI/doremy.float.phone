"use client";

import { useMemo, useState } from "react";
import { RotateCcw, X } from "lucide-react";
import { CustomStatusFrame } from "@/components/chat/custom-status-frame";
import {
  DEFAULT_VN_STATUS_CONFIG,
  parseVnStatusRaw,
  type VnStatusConfig,
  type VnStatusMode,
} from "@/lib/vn-status-region";

export function VnStatusSettings({
  initial,
  onClose,
  onSave,
}: {
  initial: VnStatusConfig;
  onClose: () => void;
  onSave: (config: VnStatusConfig) => void;
}) {
  const [draft, setDraft] = useState<VnStatusConfig>({ ...initial });
  const [previewHtml, setPreviewHtml] = useState(initial.renderHtml);
  const [previewCss, setPreviewCss] = useState(initial.css);
  const parsed = useMemo(() => parseVnStatusRaw(draft.previewRaw), [draft.previewRaw]);
  const bars = parsed.fields.filter(field => field.kind === "bar");
  const chips = parsed.fields.filter(field => field.kind === "text");
  const custom = draft.mode === "custom" && previewHtml.trim().length > 0;

  const update = (patch: Partial<VnStatusConfig>) => setDraft(current => ({ ...current, ...patch }));
  const setMode = (mode: VnStatusMode) => update({ mode });

  return (
    <div className="vn-status-settings-backdrop" onClick={event => { event.stopPropagation(); onClose(); }}>
      <section className="vn-status-settings" onClick={event => event.stopPropagation()}>
        <header>
          <div>
            <span>VN STATUS</span>
            <h2>状态浮窗</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭状态设置"><X size={18} /></button>
        </header>

        <div className="vn-status-settings-modes">
          {([
            ["off", "关闭"],
            ["native", "原生卡"],
            ["custom", "自定义"],
          ] as const).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              data-active={draft.mode === mode ? "true" : undefined}
              onClick={() => setMode(mode)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="vn-status-settings-scroll">
          <label className="vn-status-field">
            <span>输出契约 <em>每轮注入提示词</em></span>
            <textarea
              value={draft.contract}
              onChange={event => update({ contract: event.target.value })}
              spellCheck={false}
            />
          </label>

          <label className="vn-status-field">
            <span>预览数据 <em>只用于设置页</em></span>
            <textarea
              value={draft.previewRaw}
              onChange={event => update({ previewRaw: event.target.value })}
              spellCheck={false}
              className="is-short"
            />
          </label>

          {draft.mode === "custom" ? (
            <>
              <label className="vn-status-field">
                <span>渲染 HTML <em>沙盒 iframe</em></span>
                <textarea
                  value={draft.renderHtml}
                  onChange={event => update({ renderHtml: event.target.value })}
                  spellCheck={false}
                  className="is-code"
                />
              </label>
              <label className="vn-status-field">
                <span>渲染 CSS <em>只作用于状态浮窗</em></span>
                <textarea
                  value={draft.css}
                  onChange={event => update({ css: event.target.value })}
                  spellCheck={false}
                  className="is-code"
                />
              </label>
            </>
          ) : null}

          <div className="vn-status-preview-head">
            <span>预览</span>
            <button
              type="button"
              onClick={() => {
                setPreviewHtml(draft.renderHtml);
                setPreviewCss(draft.css);
              }}
            >
              刷新预览
            </button>
          </div>
          <div className="vn-status-preview">
            {custom ? (
              <CustomStatusFrame html={previewHtml} raw={draft.previewRaw} css={previewCss} title="状态浮窗预览" />
            ) : (
              <div className="vn-status-native is-preview">
                {bars.map(field => (
                  <div className="vn-status-bar-row" key={field.key}>
                    <span>{field.key}</span>
                    <i><b style={{ width: `${field.numeric ?? 0}%` }} /></i>
                    <em>{Math.round(field.numeric ?? 0)}</em>
                  </div>
                ))}
                {chips.length > 0 ? (
                  <div className="vn-status-chips">
                    {chips.map(field => <span key={field.key}>{field.key.replace("状态", "")} · {field.value}</span>)}
                  </div>
                ) : null}
                {parsed.inner ? <p className="vn-status-inner">“{parsed.inner}”</p> : null}
                {!bars.length && !chips.length && !parsed.inner ? <p className="vn-status-empty">等待状态</p> : null}
              </div>
            )}
          </div>
        </div>

        <footer>
          <button
            type="button"
            className="is-ghost"
            onClick={() => {
              setDraft({ ...DEFAULT_VN_STATUS_CONFIG, mode: draft.mode });
              setPreviewHtml(DEFAULT_VN_STATUS_CONFIG.renderHtml);
              setPreviewCss(DEFAULT_VN_STATUS_CONFIG.css);
            }}
          >
            <RotateCcw size={13} /> 恢复默认模板
          </button>
          <div>
            <button type="button" className="is-ghost" onClick={onClose}>取消</button>
            <button type="button" className="is-primary" onClick={() => onSave({ ...draft })}>
              保存
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
