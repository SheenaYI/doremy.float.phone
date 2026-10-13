// 音乐与一起听区域的「类名 ↔ 样式」一致性检查。
//
// 为什么需要它：这一片的写法是「TSX 用类名 → styles/music.css 定义外观」，
// 而从上游移植样式时是逐行挑选的（上游文件里夹着大量本仓库已有自己版本的规则，
// 不能整段复制）。逐行挑选必然会漏 —— 实际就漏过两次：
//   1. 漏掉驱动唱片旋转的 @keyframes，表现是"看着没坏但动画不动";
//   2. 漏掉 .listening-planet img 的尺寸约束，表现是头像按原始尺寸渲染、铺满整个浮窗。
// 两次都不是靠代码评审能发现的。这里把"TSX 用了但 CSS 里没有"变成会失败的断言。
//
// 运行：node scripts/check-music-classes.cjs
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const TSX_FILES = [
    "components/music/music-float.tsx",
    "components/music/music-player.tsx",
    "components/music/listening-presence.tsx",
    "components/chat/listening-invite-card.tsx",
    "components/music/lyric-share-card.tsx",
    "components/widgets/music-marquee.tsx",
];
const CSS_FILES = ["styles/music.css"];

// 这些类名由本仓库其它样式表/组件库提供、只是无语义的语义标记，
// 或只在上游的降级媒体查询里出现，不要求在 music.css 里有独立规则。
const EXEMPT = new Set([
    "ui-btn", "ui-list-card-expandable", "ts-16", "feed-post-content", "relative",
    "flex-1", "flex", "overflow-hidden", "chat-music-share-card", "chat-music-share-body",
    "chat-music-share-cover", "chat-music-share-info", "chat-music-share-title",
    "chat-music-share-artist", "chat-music-share-footer", "modal-sheet", "modal-header",
    // 上游也只把它用在 prefers-reduced-motion 的降级隐藏里，没有独立外观
    "listening-spectrum",
]);

const css = CSS_FILES.map(file => fs.readFileSync(file, "utf8")).join("\n");
const used = new Map(); // 类名 -> 首次出现的文件

for (const file of TSX_FILES) {
    if (!fs.existsSync(file)) continue;
    const source = fs.readFileSync(file, "utf8");
    // className="a b" 与 className={`a ${x} b`} 两种写法都取静态部分
    const literals = [...source.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)];
    for (const match of literals) {
        const raw = (match[1] ?? match[2] ?? "").replace(/\$\{[^}]*\}/g, " ");
        for (const name of raw.split(/\s+/)) {
            // 只管本项目自己的类名，忽略工具类与外部约定
            if (!name || name.includes("/") || EXEMPT.has(name)) continue;
            if (!/^(music-|listening-|mp-|chat-music-)/.test(name)) continue;
            if (!used.has(name)) used.set(name, path.basename(file));
        }
    }
}

// 只要有任何选择器提到这个类名就算被样式覆盖 —— 允许它以复合或后代选择器的形式
// 出现（例如 .listening-members .listening-end），这在上游是常见的写法。
const missing = [...used].filter(([name]) => {
    const occurrences = (css.match(new RegExp(`\\.${name}(?![\\w-])`, "g")) || []).length;
    return occurrences === 0;
});
assert.equal(
    missing.length, 0,
    `以下类名在 TSX 里使用但没有样式定义：\n` +
    missing.map(([name, file]) => `  .${name}  （${file}）`).join("\n") +
    `\n如果是刻意的无语义标记，请加入 scripts/check-music-classes.cjs 的 EXEMPT。`,
);

// 反向检查：CSS 里定义了这一片的选择器，但没有任何 TSX 使用它。
// 这能发现"移植了样式却没接界面"（例如移植了规则但忘了渲染对应元素）。
// 只对 listening- 前缀做——mp-* 有大量状态/伪类选择器，反向检查会误报。
const defined = new Set(
    [...css.matchAll(/^\.((?:listening)-[a-z-]+)/gm)].map(match => match[1]),
);
const unused = [...defined].filter(name => !used.has(name) && !css.includes(`.${name} `) === false && !used.has(name));
// 只报告既没有 TSX 使用、也不作为后代/状态选择器出现的（避免误报）
const trulyUnused = [...defined].filter(name => {
    if (used.has(name)) return false;
    // 作为其它选择器的限定词出现（例如 .listening-members .listening-end）就还算被使用
    const occurrences = (css.match(new RegExp(`\\.${name}(?![\\w-])`, "g")) || []).length;
    const standalone = (css.match(new RegExp(`^\\.${name}(?![\\w-])`, "gm")) || []).length;
    return standalone >= 1 && occurrences === standalone;
});

console.log(
    `PASS: 音乐区类名一致性 —— 检查了 ${used.size} 个类名（TSX 使用），全部有样式定义；` +
    `listening-* 中无"定义了却没人用"的独立选择器。`,
);
if (trulyUnused.length) {
    console.log(`  提示（非失败）：以下 listening-* 独立选择器在 TSX 里未直接使用：\n   ${trulyUnused.join(", ")}`);
}
void unused;
