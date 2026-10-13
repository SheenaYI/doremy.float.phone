const fs = require('node:fs');
const assert = require('node:assert/strict');
const ts = require('typescript');
const vm = require('node:vm');
const source = fs.readFileSync('lib/music-share-resolution.ts', 'utf8');
const transformed = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const matchExports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/music-song-match.ts','utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText, {exports:matchExports});
const exportsObject = {};
vm.runInNewContext(transformed, { exports: exportsObject, require: name => name.endsWith('music-song-match') ? matchExports : name.endsWith('music-service') ? {} : name.endsWith('music-storage') ? {} : require(name) });
const { selectSharedSong } = exportsObject;
const rows = [
  { source:'netease', title:'Sway', artist:'Michael Bublé', neteaseResult:{ id: 1, name:'Sway', artists:'Michael Bublé', album:'Call Me Irresponsible', duration: 180000, coverUrl:'https://cover/1.jpg' } },
  { source:'netease', title:'Sway', artist:'Dean Martin', neteaseResult:{ id: 2, name:'Sway', artists:'Dean Martin', album:'Classic', duration: 180000, coverUrl:'https://cover/2.jpg' } },
];
assert.equal(selectSharedSong(rows, 'Sway', 'Michael Bublé').neteaseResult.id, 1);
assert.equal(selectSharedSong(rows, 'Sway', 'Dean Martin').neteaseResult.id, 2);
assert.equal(selectSharedSong(rows, 'Sway').neteaseResult.id, 1);
assert.equal(selectSharedSong(rows, 'Unknown'), null);
assert.equal(selectSharedSong(rows, 'Sway', 'Other singer'), null);
console.log('PASS: artist-qualified selection, title-only search ranking and unrelated-song rejection.');

