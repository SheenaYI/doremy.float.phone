// 一起听邀请卡片的一致性与手势契约检查。
//
// 为什么需要它：这套卡片是「TSX 用类名 → music.css 定义外观」的分工，而 CSS 是靠
// data-status 的状态选择器驱动唱片滑动与旋转的。两处一旦漂移（改了类名没补样式、
// 改了状态取值没改选择器），表现是"看上去没坏但动画不动"，非常难在代码评审里发现。
// 这里把这种漂移变成会失败的断言。
//
// 运行：node scripts/check-listening-invite-card.cjs
const fs = require("node:fs");
const assert = require("node:assert/strict");

const TSX = "components/chat/listening-invite-card.tsx";
const CSS = "styles/music.css";
const tsx = fs.readFileSync(TSX, "utf8");
const css = fs.readFileSync(CSS, "utf8");

// 1) 卡片用到的每个 listening-*/ui-* 类名都必须在 music.css 里有对应规则。
const used = new Set(
    Array.from(tsx.matchAll(/className="([^"]+)"/g))
        .flatMap(match => match[1].split(/\s+/))
        .filter(name => name.startsWith("listening-")),
);
assert.ok(used.size >= 8, `应当用到多个 listening-* 类名，实际 ${used.size}`);
for (const name of used) {
    assert.ok(css.includes(`.${name}`), `music.css 缺少类名定义：.${name}`);
}

// 2) data-status 的取值必须与 CSS 里的状态选择器一致。
//    卡片可能写入 accepted / declined / joined / invited / undefined；
//    CSS 至少要覆盖 accepted / declined / joined 这三个驱动动画的终态。
for (const state of ["accepted", "declined", "joined"]) {
    assert.ok(
        css.includes(`.listening-invite-record[data-status="${state}"]`),
        `music.css 缺少 data-status="${state}" 的选择器`,
    );
}

// 3) 驱动唱片旋转的关键帧必须存在，且被卡片样式引用。
assert.ok(css.includes("@keyframes listening-invite-disc-spin"), "缺少唱片旋转关键帧");
assert.ok(/\.listening-record-disc[^}]*animation:listening-invite-disc-spin/.test(css), "唱片未引用旋转关键帧");

// 4) 手势阈值契约：与卡片内的常量保持一致。改常量必须同步改这里，避免无声漂移。
const threshold = tsx.match(/const SWIPE_THRESHOLD = (\d+)/);
const rest = tsx.match(/const SLIDE_REST = (\d+)/);
const joined = tsx.match(/const SLIDE_JOINED = (\d+)/);
assert.ok(threshold && rest && joined, "未找到滑动常量");
assert.equal(Number(threshold[1]), 20, "SWIPE_THRESHOLD 应为 20（与上游一致）");
assert.equal(Number(rest[1]), 27, "唱片静止位移应为 27（与 CSS 的 translateX 一致）");
assert.equal(Number(joined[1]), 70, "加入后的位移应为 70（与 CSS 的 translateX 一致）");
// 静止位移必须与 CSS 里 .listening-record-slide 的初始 translateX 对得上，
// 否则手指还没动唱片就会跳一下。
assert.ok(
    new RegExp(`\\.listening-record-slide[^}]*transform:translateX\\(${rest[1]}px\\)`).test(css),
    `.listening-record-slide 的初始 translateX 应为 ${rest[1]}px`,
);

// 5) 键盘可达性：滑动必须同时有键盘等价操作，否则这项交互对键盘用户不可用。
assert.ok(tsx.includes("ArrowRight") && tsx.includes("ArrowLeft"), "缺少键盘等价操作");
assert.ok(tsx.includes("touchAction"), "缺少 touch-action 处理（否则横滑会被浏览器吞掉）");

// 6) 退出入口不能被移除：双向流程的"中途退出"依赖它。
assert.ok(tsx.includes("exitListeningRoom"), "卡片缺少退出入口");

console.log(
    `PASS: 邀请卡一致性 —— ${used.size} 个类名均有样式、data-status 选择器齐全、` +
    `唱片关键帧已引用、滑动常量与 CSS 对得上、键盘等价操作与退出入口均在。`,
);
