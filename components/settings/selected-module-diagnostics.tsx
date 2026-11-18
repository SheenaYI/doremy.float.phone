'use client';
import { useState } from 'react';
import { readWidgetDiagnostics, hasWidgetBridge } from '@/lib/widget/bridge';
export function SelectedModuleDiagnostics() {
  const [widget, setWidget] = useState<ReturnType<typeof readWidgetDiagnostics>>(null);
  const [watch, setWatch] = useState('');
  const [checked, setChecked] = useState(false);
  return <section style={{ display:'grid', gap:10 }}><h3>功能检查</h3>
    <button type="button" onClick={() => { setWidget(readWidgetDiagnostics()); setChecked(true); try { setWatch(localStorage.getItem('watch_last_diagnostics_report_v1') || ''); } catch {} }}>读取功能状态</button>
    {checked && <><p>真实桌面组件：{hasWidgetBridge() ? widget?.renderOk ? '最近渲染成功' : '原生接口可用，展开查看渲染情况' : '当前环境没有原生接口'}</p>
    {widget && <details><summary>组件渲染详情</summary><pre style={{ whiteSpace:'pre-wrap' }}>{JSON.stringify(widget, null, 2)}</pre></details>}
    <details><summary>一起看播放诊断</summary><pre style={{ whiteSpace:'pre-wrap' }}>{watch || '请先在一起看设置中生成播放诊断报告。'}</pre></details></>}
  </section>;
}
