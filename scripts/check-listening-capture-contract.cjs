// 「一起听」捕获契约的回归测试。
//
// 为什么单独写而不是照搬上游 scripts/check-music-listening.cjs：那个脚本 mock 了
// pushChatMessage 的十几个内部依赖（插件钩子、DB、缓存、会话预览、身份空间），
// 与本仓库的实现已经不同，整体照搬既费事又会随重构腐烂。这里改为锁定**契约本身**：
// 只有带歌词引用时才返回上下文，普通发言一律返回 null。
//
// 运行：node scripts/check-listening-capture-contract.cjs
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const assert = require("node:assert/strict");

/** 用 CommonJS 转译并在沙箱里求值，require 由调用方按模块名提供替身。 */
function load(file, mocks = {}) {
    const exports = {};
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync(file, "utf8"), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        }).outputText,
        { exports, console, Intl, require: name => mocks[name] || {} },
        { filename: file },
    );
    return exports;
}

const OWNER = "local";
const identity = {
    assertIdentityActive() { /* 单用户：恒有活跃身份 */ },
    getCurrentIdentityId: () => OWNER,
};
const { captureMusicListeningContext } = load("lib/music-listening-capture.ts", {
    "./local-identity": identity,
    "./music-listening": {},
});

const sentAt = "2026-10-06T00:00:45.000Z";
const lyric = (text, time) => ({ time, text });
const reference = {
    version: 1, identityId: OWNER, capturedAt: sentAt, trackId: "song-a",
    title: "测试歌曲", artist: "歌手", position: 45, isPlaying: true,
    lines: [lyric("最前一句", 30), lyric("上一句的海", 38.5), lyric("此刻的蓝", 44)],
    reference: lyric("上一句的海", 38.5),
};

// 契约 1：普通发言不带上下文。
// 这条最关键 —— 若这里返回了对象，每条聊天消息都会挂上一份语境，
// 下游「历史里是否出现过音乐内容」的判断就永远为真。
assert.equal(captureMusicListeningContext(sentAt), null, "普通发言必须返回 null");
assert.equal(captureMusicListeningContext(sentAt, null), null, "显式 null 引用返回 null");

// 契约 2：带引用时返回上下文，且刷新捕获时间。
const captured = captureMusicListeningContext(sentAt, reference);
assert.ok(captured, "带歌词引用时应返回上下文");
assert.equal(captured.trackId, "song-a");
assert.equal(captured.reference.text, "上一句的海");
assert.equal(captured.reference.time, 38.5);
assert.equal(captured.capturedAt, sentAt);

// 契约 3：引用跟随它原本的来源歌曲，不会被当前播放替换。
assert.equal(captured.lines.length, 3);
assert.deepEqual(Array.from(captured.lines, line => line.time), [30, 38.5, 44]);

// 契约 4：返回的是副本，调用方后续改动不会污染传入的引用。
captured.lines[0].text = "被改过了";
captured.reference.text = "也被改过了";
assert.equal(reference.lines[0].text, "最前一句", "lines 必须是副本");
assert.equal(reference.reference.text, "上一句的海", "reference 必须是副本");

// 契约 5：身份不匹配的引用不被采纳（单用户下身份恒定，这里直接构造不匹配值）。
assert.equal(captureMusicListeningContext(sentAt, { ...reference, identityId: "someone-else" }), null, "身份不匹配应拒绝");
// 只有 reference 缺失时同样不采纳
assert.equal(captureMusicListeningContext(sentAt, { ...reference, reference: undefined }), null, "缺 reference 应拒绝");

console.log("PASS: 捕获契约 —— 普通发言不带上下文、带引用时返回副本、身份不匹配被拒绝。");
