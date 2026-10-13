const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript'), assert = require('node:assert/strict');
const source = fs.readFileSync('lib/music-context.tsx', 'utf8');
const ast = ts.createSourceFile('music.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback;
function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'handleTrackEnd') callback = node.initializer.arguments[0].getText(ast);
    ts.forEachChild(node, visit);
}
visit(ast);
const code = ts.transpileModule(`(${callback})()`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const a = { id: 'a' }, b = { id: 'b' };
function ended(queue, current, joined, mode = 'sequence') {
    const played = [];
    vm.runInNewContext(code, {
        setCurrentTrack: fn => fn(current), setQueueRaw: fn => fn(queue),
        playModeRef: { current: mode }, getListeningRoom: () => joined ? { status: 'joined' } : null,
        setTimeout: fn => fn(), loadAndPlay: track => played.push(track.id),
    });
    return played;
}
assert.deepEqual(ended([a,b], a, true), ['b']);
assert.deepEqual(ended([a,b], b, true), ['a']);
assert.deepEqual(ended([a], a, true), ['a']);
assert.deepEqual(ended([], a, true), []);
assert.deepEqual(ended([a,b], b, false), []);
assert.deepEqual(ended([a,b], a, true, 'repeat-one'), ['a']);
console.log('PASS: actual track-ended callback continues queue, wraps while listening, handles one/zero tracks, preserves solo sequence and repeat-one.');
