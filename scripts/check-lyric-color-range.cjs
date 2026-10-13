const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript'), assert = require('node:assert/strict');
function load(file) {
    const exports = {};
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, require: () => ({}) });
    return exports;
}
const { lyricRange, activeLyricIndex } = load('lib/lyric-selection.ts');
const { parseTimedLyrics, createMusicListeningContext, musicListeningHistoryText } = load('lib/music-listening.ts');
const lines = parseTimedLyrics('[00:01.00]First\n[00:02.00]\n[00:02.50]Second\n[00:03.00]Third');
assert.equal(activeLyricIndex(lines, .999), -1);
assert.equal(activeLyricIndex(lines, 1), 0);
assert.equal(activeLyricIndex(lines, 2), 1); // Instrumental gap stays blank.
assert.equal(activeLyricIndex(lines, 2.5), 2);
assert.equal(activeLyricIndex(lines, 1.5), 0); // Seeking back.
assert.equal(activeLyricIndex([], 50), -1);
assert.equal(lyricRange(lines, 0, 3).map(l => l.text).join('\n'), 'First\nSecond\nThird');
assert.equal(lyricRange(lines, 3, 0).map(l => l.text).join('\n'), 'First\nSecond\nThird');
assert.equal(lyricRange(lines, 2, 2).length, 1);
const selectedLines = lyricRange(lines, 0, 3);
const context = createMusicListeningContext({ currentTrack: { id: 'test', title: 'Test', artist: 'Test', lyrics: '' }, currentTime: 15, isPlaying: true }, 'test', 'now', lines[0]);
const history = musicListeningHistoryText({ role: 'user', listeningContext: { ...context, selectedLines, reference: { time: 1, text: selectedLines.map(l => l.text).join('\n') } } }, '');
assert.match(history, /明确引用 00:01：First/);
assert.match(history, /明确引用 00:02：Second/);
assert.match(history, /明确引用 00:03：Third/);
const { lyricColorFromPixels } = load('lib/lyric-card-color.ts');
assert.equal(lyricColorFromPixels([0, 0, 0, 255]).color, '#fff');
assert.equal(lyricColorFromPixels([255, 255, 255, 255]).color, '#000');
assert.equal(lyricColorFromPixels([20, 80, 190, 255, 20, 80, 190, 255, 255, 0, 0, 255]).background, 'rgb(20,80,190)');
assert.equal(lyricColorFromPixels([0, 0, 0, 0]).background, '#eadde3');
const palette = (...entries) => lyricColorFromPixels(entries.flatMap(([rgb, count, alpha = 255]) => Array.from({ length: count }, () => [...rgb, alpha]).flat()));
const black = [8, 8, 8], grey = [120, 120, 120], white = [250, 250, 250], orange = [210, 130, 40];
assert.equal(palette([black, 60], [orange, 40]).background, 'rgb(210,130,40)', 'skip first neutral');
assert.equal(palette([black, 50], [grey, 30], [orange, 20]).background, 'rgb(210,130,40)', 'third candidate');
assert.equal(palette([black, 40], [grey, 30], [white, 20], [orange, 10]).background, 'rgb(8,8,8)', 'do not search fourth candidate');
assert.equal(palette([black, 96], [orange, 4]).background, 'rgb(8,8,8)', 'ignore tiny accent');
assert.equal(palette([black, 95], [orange, 5]).background, 'rgb(210,130,40)', '5% boundary');
assert.equal(palette([black, 95, 0], [orange, 5]).background, 'rgb(210,130,40)', 'coverage excludes transparent pixels');
assert.equal(palette([black, 6], [grey, 5], [white, 4], [[200,120,40], 3], [[220,140,50], 3]).background, 'rgb(210,130,45)', 'merge shades before ranking');
assert.equal(palette([[5, 10, 25], 60], [orange, 40]).background, 'rgb(210,130,40)', 'reject near-black colour');
assert.equal(palette([white, 60], [grey, 40]).background, 'rgb(250,250,250)', 'monochrome keeps dominant shade');
for (let value = 0; value <= 255; value++) {
    const result = lyricColorFromPixels([value, value, value, 255]);
    const s = value / 255, l = s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4;
    const contrast = result.color === '#000' ? (l + .05) / .05 : 1.05 / (l + .05);
    assert.ok(contrast >= 4.5, `contrast ${value}`);
}
