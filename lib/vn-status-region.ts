// lib/vn-status-region.ts
// 漫卷「状态浮窗」：角色级配置 + 默认契约 + 原生字段解析。
// 自定义渲染走 CustomStatusFrame 沙盒，原生模式不执行任何用户代码。

import { kvGet, kvSet, registerKvMigration } from "./kv-db";

export type VnStatusMode = "off" | "native" | "custom";

export type VnStatusConfig = {
    mode: VnStatusMode;
    /** 告诉 AI 输出什么；启用时注入 VN 提示词 */
    contract: string;
    /** 自定义渲染 HTML；为空时用原生卡 */
    renderHtml: string;
    /** 只作用于自定义渲染 iframe 的 CSS */
    css: string;
    /** 设置页预览用样例，不参与提示词 */
    previewRaw: string;
};

export type VnStatusLayout = {
    /** 百分比坐标（相对 VN 画面） */
    x: number;
    y: number;
    collapsed?: boolean;
};

export type VnStatusField = {
    key: string;
    value: string;
    numeric: number | null;
    kind: "bar" | "text";
};

export type ParsedVnStatus = {
    raw: string;
    fields: VnStatusField[];
    inner: string;
    values: Record<string, string>;
};

const CONFIG_KEY = "ai_phone_vn_status_region_v1";
const LAYOUT_KEY = "ai_phone_vn_status_layout_v1";
registerKvMigration(CONFIG_KEY);
registerKvMigration(LAYOUT_KEY);

export const VN_STATUS_UPDATED_EVENT = "vn-status-region-updated";

export const DEFAULT_VN_STATUS_CONTRACT = [
    "你正在维护漫卷剧情中的「状态浮窗」。",
    "每轮在 </content> 之后额外输出一个 <status> 块，格式如下：",
    "<status>",
    "好感度: 72",
    "心疼: 80",
    "欲望: 60",
    "占有欲: 45",
    "工作状态: 赶稿中",
    "身体状态: 有点累",
    "心情: 克制但愉快",
    "天气: 小雨",
    "内心: 她今天来得比平时早。",
    "</status>",
    "",
    "规则：",
    "- 好感度、心疼、欲望、占有欲是 0-100 的整数，按当前剧情自然变化，不要每轮大幅跳动。",
    "- 工作状态、身体状态、心情、天气每轮都要输出；天气没有变化也写当前天气。用 2-8 个字，不要写成整段。",
    "- 内心是角色没有说出口的一句话，40 字以内，不要加引号以外的前缀。",
    "- 没有变化的字段可以省略，前端会沿用上一轮的值。",
    "- 不要输出地点、关系、章节、时间；这些由 APP 自己知道。",
    "- <status> 只能出现在 </content> 之后，不要放进 <scene> 或台词里。",
    "- 不要使用 [好感度:X]、[内心]...[/内心] 等聊天室旧协议。",
].join("\n");

export const DEFAULT_VN_STATUS_PREVIEW = [
    "好感度: 72",
    "心疼: 80",
    "欲望: 60",
    "占有欲: 45",
    "工作状态: 赶稿中",
    "身体状态: 有点累",
    "心情: 克制但愉快",
    "天气: 小雨",
    "内心: 她今天来得比平时早。",
].join("\n");

export const DEFAULT_VN_STATUS_RENDER = `<div class="vns-card" id="vnsCard">
  <div class="vns-top"><span>STATUS</span><em id="vnsWeather"></em></div>
  <div class="vns-bars" id="vnsBars"></div>
  <div class="vns-chips" id="vnsChips"></div>
  <div class="vns-inner" id="vnsInner"></div>
</div>
<script>
(function(){
  var raw = String(window.STATUS_RAW || "");
  var barKeys = ["好感度", "心疼", "欲望", "占有欲"];
  var chipKeys = ["工作状态", "身体状态", "心情"];
  var values = {};
  raw.split(/\\n+/).forEach(function(line){
    var m = line.match(/^\\s*([^:：=]+?)\\s*[:：=]\\s*(.+?)\\s*$/);
    if (m) values[m[1]] = m[2];
  });
  var bars = document.getElementById("vnsBars");
  barKeys.forEach(function(key){
    var value = parseFloat(values[key]);
    if (!isFinite(value)) return;
    var row = document.createElement("div");
    row.className = "vns-bar-row";
    row.innerHTML = '<span class="vns-label">' + key + '</span><span class="vns-track"><i style="width:' + Math.max(0, Math.min(100, value)) + '%"></i></span><b>' + Math.round(value) + '</b>';
    bars.appendChild(row);
  });
  var chips = document.getElementById("vnsChips");
  chipKeys.forEach(function(key){
    if (!values[key]) return;
    var chip = document.createElement("span");
    chip.className = "vns-chip";
    chip.textContent = key.replace("状态", "") + " · " + values[key];
    chips.appendChild(chip);
  });
  var weather = values["天气"] || "";
  if (weather) document.getElementById("vnsWeather").textContent = weather;
  var inner = values["内心"] || values["内心独白"] || "";
  var innerEl = document.getElementById("vnsInner");
  if (inner) innerEl.textContent = "“" + inner + "”"; else innerEl.remove();
})();
</script>`;

export const DEFAULT_VN_STATUS_CSS = `:root{
  --vns-ink:#f6f1e8;
  --vns-muted:rgba(246,241,232,.56);
  --vns-accent:#e0b979;
  --vns-line:rgba(255,255,255,.16);
}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:transparent;color:var(--vns-ink);font-family:"Songti SC","Noto Serif SC",serif}
body{padding:2px}
.vns-card{
  position:relative;
  padding:12px 13px 11px;
  border-radius:16px;
  overflow:hidden;
  background:linear-gradient(145deg,rgba(255,255,255,.16),rgba(18,18,22,.52) 42%,rgba(10,10,14,.72));
  border:1px solid var(--vns-line);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.22),0 14px 34px rgba(0,0,0,.3);
  backdrop-filter:blur(16px) saturate(150%);
  -webkit-backdrop-filter:blur(16px) saturate(150%);
}
.vns-card:before{
  content:"";
  position:absolute;
  inset:-40% -20% auto -20%;
  height:90%;
  background:radial-gradient(ellipse at 24% 0%,rgba(255,255,255,.22),transparent 62%);
  pointer-events:none;
}
.vns-top{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:9px}
.vns-top span{font:700 8px/1 "Helvetica Neue",Arial,sans-serif;letter-spacing:.22em;color:var(--vns-muted)}
.vns-top em{font:400 9px/1 "Songti SC","Noto Serif SC",serif;font-style:normal;color:var(--vns-muted)}
.vns-bars{display:flex;flex-direction:column;gap:6px}
.vns-bar-row{display:grid;grid-template-columns:44px minmax(0,1fr) 24px;align-items:center;gap:7px}
.vns-label{font-size:10px;color:var(--vns-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vns-track{height:4px;border-radius:999px;background:rgba(255,255,255,.12);overflow:hidden}
.vns-track i{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,rgba(224,185,121,.5),var(--vns-accent))}
.vns-bar-row b{font:700 10px/1 "Helvetica Neue",Arial,sans-serif;text-align:right;color:var(--vns-ink);font-variant-numeric:tabular-nums}
.vns-chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:10px}
.vns-chip{font:10px/1.2 "Songti SC","Noto Serif SC",serif;color:rgba(246,241,232,.78);padding:3px 6px;border:1px solid rgba(255,255,255,.12);border-radius:999px;background:rgba(255,255,255,.05)}
.vns-inner{margin-top:10px;padding-top:8px;border-top:1px solid rgba(255,255,255,.12);font:italic 10.5px/1.55 "Songti SC","Noto Serif SC",serif;color:rgba(246,241,232,.68)}
@media(prefers-reduced-motion:reduce){.vns-card{backdrop-filter:none;-webkit-backdrop-filter:none;background:rgba(16,16,20,.9)}}`;

export const DEFAULT_VN_STATUS_CONFIG: VnStatusConfig = {
    mode: "off",
    contract: DEFAULT_VN_STATUS_CONTRACT,
    renderHtml: DEFAULT_VN_STATUS_RENDER,
    css: DEFAULT_VN_STATUS_CSS,
    previewRaw: DEFAULT_VN_STATUS_PREVIEW,
};

function loadAll(): Record<string, VnStatusConfig> {
    if (typeof window === "undefined") return {};
    try {
        const parsed = JSON.parse(kvGet(CONFIG_KEY) || "{}") as unknown;
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? parsed as Record<string, VnStatusConfig>
            : {};
    } catch {
        return {};
    }
}

function normalizeConfig(raw: Partial<VnStatusConfig> | undefined): VnStatusConfig {
    if (!raw || typeof raw !== "object") return { ...DEFAULT_VN_STATUS_CONFIG };
    return {
        mode: raw.mode === "native" || raw.mode === "custom" ? raw.mode : "off",
        contract: typeof raw.contract === "string" ? raw.contract : DEFAULT_VN_STATUS_CONTRACT,
        renderHtml: typeof raw.renderHtml === "string" ? raw.renderHtml : DEFAULT_VN_STATUS_RENDER,
        css: typeof raw.css === "string" ? raw.css : DEFAULT_VN_STATUS_CSS,
        previewRaw: typeof raw.previewRaw === "string" ? raw.previewRaw : DEFAULT_VN_STATUS_PREVIEW,
    };
}

export function getVnStatusConfig(characterId: string): VnStatusConfig {
    const own = loadAll()[characterId];
    return normalizeConfig(own);
}

export function saveVnStatusConfig(characterId: string, config: VnStatusConfig): void {
    if (typeof window === "undefined" || !characterId) return;
    const all = loadAll();
    if (config.mode === "off" && !config.contract.trim() && !config.renderHtml.trim()) {
        delete all[characterId];
    } else {
        all[characterId] = normalizeConfig(config);
    }
    kvSet(CONFIG_KEY, JSON.stringify(all));
    window.dispatchEvent(new CustomEvent(VN_STATUS_UPDATED_EVENT, { detail: { characterId } }));
}

export function isVnStatusActive(config: VnStatusConfig): boolean {
    return config.mode !== "off";
}

/** 启用状态浮窗时追加的系统指令；不写进预设，兼容社区预设。 */
export function buildVnStatusInstruction(config: VnStatusConfig): string {
    if (!isVnStatusActive(config)) return "";
    return [
        "<vn_status_instruction>",
        "【状态浮窗已启用】本轮需要额外输出一个角色状态块。",
        "把 <status>...</status> 放在 </content> 之后；不要放进 <scene>，不要写进台词或旁白。",
        "这是唯一允许的状态块；如与前面的‘禁止状态标签’规则冲突，仅对 <status> 块以本条为准。",
        "不要使用 [好感度:X]、[内心]...[/内心] 等聊天室旧协议。",
        "",
        "状态契约：",
        config.contract.trim(),
        "</vn_status_instruction>",
    ].join("\n");
}

function loadLayouts(): Record<string, VnStatusLayout> {
    if (typeof window === "undefined") return {};
    try {
        const parsed = JSON.parse(kvGet(LAYOUT_KEY) || "{}") as unknown;
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? parsed as Record<string, VnStatusLayout>
            : {};
    } catch {
        return {};
    }
}

export function getVnStatusLayout(characterId: string): VnStatusLayout {
    const own = loadLayouts()[characterId];
    return {
        x: typeof own?.x === "number" ? own.x : 64,
        y: typeof own?.y === "number" ? own.y : 12,
        collapsed: own?.collapsed === true,
    };
}

export function saveVnStatusLayout(characterId: string, layout: VnStatusLayout): void {
    if (typeof window === "undefined" || !characterId) return;
    const all = loadLayouts();
    all[characterId] = {
        x: Math.max(0, Math.min(82, Math.round(layout.x))),
        y: Math.max(0, Math.min(78, Math.round(layout.y))),
        collapsed: layout.collapsed === true,
    };
    kvSet(LAYOUT_KEY, JSON.stringify(all));
}

/** 解析 key:value / key=value / [key:value] 形式的状态原文。 */
export function parseVnStatusRaw(raw: string): ParsedVnStatus {
    const fields: VnStatusField[] = [];
    const values: Record<string, string> = {};
    let inner = "";
    const push = (key: string, value: string) => {
        const cleanKey = key.trim().replace(/^[#＃\s]+/, "").slice(0, 20);
        const cleanValue = value.trim().replace(/^["“]|["”]$/g, "").slice(0, 120);
        if (!cleanKey || !cleanValue) return;
        if (cleanKey === "内心" || cleanKey === "内心独白") {
            inner = cleanValue;
            values[cleanKey] = cleanValue;
            return;
        }
        const numeric = /^\d+(?:\.\d+)?$/.test(cleanValue)
            ? Math.max(0, Math.min(100, Number(cleanValue)))
            : null;
        values[cleanKey] = cleanValue;
        fields.push({
            key: cleanKey,
            value: cleanValue,
            numeric,
            kind: numeric === null ? "text" : "bar",
        });
    };

    for (const line of String(raw ?? "").replace(/\r\n?/g, "\n").split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const bracket = trimmed.match(/^\[([^:\]]+):(.+)\]$/);
        if (bracket) {
            push(bracket[1], bracket[2]);
            continue;
        }
        const kv = trimmed.match(/^([^:：=]+?)\s*[:：=]\s*(.+)$/);
        if (kv) push(kv[1], kv[2]);
    }

    return { raw: String(raw ?? ""), fields, inner, values };
}

/**
 * 合并上一轮与这一轮的状态；AI 省略的字段沿用旧值。
 * 只有两段都能解析成 key:value 时才合并，避免破坏自定义 JSON 契约。
 */
export function mergeVnStatusRaw(previous: string, next: string): string {
    const prev = parseVnStatusRaw(previous);
    const curr = parseVnStatusRaw(next);
    if (curr.fields.length === 0 && !curr.inner) return next || previous;
    if (prev.fields.length === 0 && !prev.inner) return next;
    const merged = new Map<string, string>();
    for (const [key, value] of Object.entries(prev.values)) merged.set(key, value);
    for (const [key, value] of Object.entries(curr.values)) merged.set(key, value);
    return Array.from(merged.entries()).map(([key, value]) => `${key}: ${value}`).join("\n");
}
