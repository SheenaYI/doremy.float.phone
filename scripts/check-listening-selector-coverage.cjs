// 一起听相关选择器的覆盖检查。
//
// 动机：从上游移植样式时，此前按"行首以 .listening- 开头"逐行筛选，凡是写成
// 后代 / 子选择器的规则（.listening-avatar-pair>span、.listening-members header、
// .listening-planets .listening-planet …）都会被整条丢掉。这类丢失不会报错，
// 表现是"头像铺满屏幕""环绕与封面错位""面板排版异常"，很难定位。
//
// 这个脚本把上游与本仓库的 listening-* 选择器做集合对比，把"悄悄丢掉的选择器"
// 变成失败断言。上游文件不在仓库里，故对比目标是一份固化的快照清单。
//
// 运行：node scripts/check-listening-selector-coverage.cjs
const fs = require("node:fs");
const assert = require("node:assert/strict");

// 刻意不移植的上游选择器，及原因。
const INTENTIONAL = {
    ".music-float[data-together] .listening-planets": "本仓库刻意不使用 data-together 属性（会覆盖原有的磨砂玻璃外观）",
    ".music-float[data-together][data-expanded] .listening-planets": "同上",
    ".mp-apple .listening-player-presence": "依赖尚未移植的 Apple Music 外壳（阶段 5）",
    ".listening-invite-card.listening-invite-bare": "邀请卡不挂 listening-invite-bare 类",
    ".listening-planets[data-orbiting=\"false\"] .listening-ring-base": "由 data-orbiting 的通配规则统一暂停，无需单列",
    ".listening-planets[data-orbiting=\"false\"] .listening-wave-window": "同上",
    ".listening-planets[data-orbiting=\"false\"] :is(.listening-ring-blush,.listening-ring-heartbeat)": "blush/heartbeat 是本实现不存在的上游残留类",
};

// 上游 listening-* 选择器快照（取自 Yyk-Y2k/ai-virtual-phone-Y2Kversion 的 styles/music.css
// 第 5360-5580 行）。新增缺失会被这里拦住。
const UPSTREAM = [".listening-planets",".listening-orbit",".listening-orbit-char",".listening-planet",".listening-orbit-char .listening-planet",".listening-planet img",".listening-avatar-pair img",".listening-member-avatar img",".listening-meeting-star",".listening-meeting-star i",".listening-planets[data-orbiting=\"false\"] *",".listening-planets[data-orbiting=\"false\"] .listening-meeting-star",".listening-planets[data-orbiting=\"false\"] .listening-ring-base",".listening-planets[data-orbiting=\"false\"] .listening-wave-window",".listening-avatar-pair",".listening-avatar-pair>span",".listening-avatar-pair>span+span",".listening-members-overlay",".listening-members",".listening-members header",".listening-members button",".listening-members header button",".listening-member",".listening-member-avatar",".listening-member small",".listening-members .listening-end",".listening-ring",".listening-ring-base",".listening-wave-window",".listening-planets .listening-planet",".listening-spectrum-bar",".listening-invite-card",".listening-invite-heading",".listening-invite-copy",".listening-invite-copy strong",".listening-invite-copy small",".listening-invite-footer",".listening-invite-footer [role=\"status\"]",".listening-invite-record",".listening-record-stage",".listening-record-sleeve",".listening-record-sleeve>img",".listening-record-sleeve-edge",".listening-record-slide",".listening-record-disc",".listening-record-label",".listening-record-label img",".listening-record-spindle",".listening-record-empty",".listening-record-empty>span",".listening-invite-record .listening-invite-copy",".listening-invite-bare .listening-record-stage",".listening-invite-gesture-hint",".listening-player-presence",".listening-avatar-pair>span",".listening-avatar-pair>span+span"];

const css = fs.readFileSync("styles/music.css", "utf8");
const present = new Set();
css.split("\n").forEach(line => {
    const m = line.match(/^([^{}]*)\{/);
    if (!m) return;
    m[1].split(",").forEach(s => {
        const t = s.trim();
        if (t.includes("listening-")) present.add(t);
    });
});

const missing = UPSTREAM.filter(sel => !present.has(sel) && !(sel in INTENTIONAL));
assert.equal(missing.length, 0,
    "以下上游 listening-* 选择器在本仓库缺失（若非刻意，多半是带后代/子选择器的规则被整条丢掉）：\n" +
    missing.map(s => "  " + s).join("\n"));

console.log(
    "PASS: 一起听选择器覆盖 —— 上游快照 " + UPSTREAM.length + " 条，本仓库均覆盖（" +
    "刻意不移植 " + Object.keys(INTENTIONAL).length + " 条已登记理由）。",
);
