/* Offline regression checks: no network, no user browser storage, no LLM calls. */
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const { performance } = require('node:perf_hooks');
function moduleUnderTest(path, deps = {}, seam = '', sourceOverride) {
  const source = (sourceOverride ?? fs.readFileSync(path, 'utf8')) + '\n' + seam;
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const result = { exports: {} };
  const fallback = new Proxy({}, { get: (_, key) => key === '__esModule' ? true : () => undefined });
  vm.runInNewContext(js, { module: result, exports: result.exports, require: name => deps[name] ?? fallback,
    console, performance, Date, Map, Set, Math, JSON, setTimeout, clearTimeout, crypto: require('node:crypto').webcrypto,
  }, { filename: path });
  return result.exports;
}
(async () => {
  const tokens = moduleUnderTest('lib/token-counter.ts');
  const reference = text => { const count = (text.match(/[\u2E80-\u9FFF\uF900-\uFAFF\uFE30-\uFE4F\u3000-\u303F\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF]/g) || []).length; return Math.ceil(count / 1.5 + (text.length - count) / 4); };
  for (let i = 0; i < 65536; i++) { const text = String.fromCharCode(i); assert.equal(tokens.estimateTokens(text), reference(text), `Unicode ${i}`); }
  const prose = '这是中文，Latin text 한국어 日本語 😀'.repeat(15000);
  assert.equal(tokens.estimateTokens(prose), reference(prose));

  const store = moduleUnderTest('lib/chat-storage.ts', {}, `
exports.__seed = (items) => { _messagesCache = items; };
exports.__append = (message) => { _messagesCache.push(message); appendSessionIndex(message); };
exports.__replace = (index, message) => { _messagesCache[index] = message; invalidateSessionIndex(); };
exports.__nextOrder = getNextMessageOrder;
`);
  let messages = Array.from({ length: 100000 }, (_, i) => ({ id: 'm' + i, sessionId: 's' + i % 100, role: 'user', content: '历史 ' + i, status: 'sent', order: i, createdAt: new Date(1700000000000 + i * 1000).toISOString() }));
  store.__seed(messages);
  const expected = id => messages.filter(m => m.sessionId === id).sort(store.compareChatMessages).map(m => m.id);
  for (const id of ['s0', 's42', 'missing']) assert.deepEqual(Array.from(store.loadChatMessages(id), m => m.id), expected(id));
  assert.deepEqual(Array.from(store.loadChatMessages('s42', 50), m => m.id), expected('s42').slice(-50));
  const added = { ...messages[0], id: 'last', order: 100001 }; store.__append(added);
  assert.equal(store.loadChatMessages('s0').at(-1).id, 'last'); assert.equal(store.__nextOrder('s0'), 100002);
  const changed = { ...messages[42], content: '修改', order: 100003 }; store.__replace(42, changed);
  assert.equal(store.loadChatMessages('s42').at(-1).content, '修改');
  const start = performance.now(); for (let i = 0; i < 100; i++) store.loadChatMessages('s42', 50); const indexedMs = performance.now() - start;
  const oldStart = performance.now(); for (let i = 0; i < 100; i++) messages.filter(m => m.sessionId === 's42').sort(store.compareChatMessages).slice(-50); const fullScanMs = performance.now() - oldStart;
  console.log(JSON.stringify({ totalMessages: messages.length, reads: 100, indexedMs: +indexedMs.toFixed(2), fullScanMs: +fullScanMs.toFixed(2) }));

  // Compare the actual optimized assembler against its complete-history path.
  // Includes ties, hidden tools, retractions, reading boundaries, source switches,
  // direct/group chat, native tool mode, zero budgets and malformed timestamps.
  let scenarioMessages = [], scenarioBudget = 100, allowedSources = {};
  const deps = {
    './performance-diagnostics': { measureSync: (_name, run) => run() },
    './chat-storage': {
      loadChatSessions: () => [{id:'direct',contactId:'c'}, {id:'group',isGroup:true,participantIds:['c'],name:'群聊'}],
      loadChatMessages: id => scenarioMessages.filter(m => m.sessionId === id).sort(store.compareChatMessages),
      isReadingDiscussMessage: m => m.mediaType === 'reading_discuss',
      isSystemInstructionMessage: m => m.mediaType === 'system_instruction',
      getSystemInstructionPromptContent: value => value,
    },
    './character-storage': { loadCharacters: () => [{id:'c',name:'角色'}] },
    './settings-storage': { resolveUserIdentity: () => ({name:'用户'}) },
    './memory-storage': { loadMemoryConfig: () => ({shortTermTokenBudget:scenarioBudget,shortTermAllowedSources:allowedSources}) },
    './token-counter': tokens,
    './prompt-sanitizer': {stripStateAndInnerForPrompt: value => value},
    './prompt-time': { resolvePromptTimeAware: value => value ?? true, formatPromptEventLabel: (label, time) => `[${label}:${time}]`, formatPromptTimestamp: value => value, formatStoredPromptEventContent: value => value },
  };
  for (const [path, names] of Object.entries({
    './moments-storage':['loadMomentPosts','loadMomentComments'], './story-storage':['loadStoryProjectionEntries'],
    './vn-storage':['loadVnProjectionEntries'], './map-storage':['loadMapProjectionEntries','loadMapSharedProjectionEntries'],
    './game-storage':['loadGameProjectionEntries'], './diary-entry-storage':['loadDiaryEntries'], './calendar-day-storage':['loadCalendarDayRecords'],
    './notewall-memory':['loadNoteWallProjectionEntries'], './xiaohongshu-memory':['loadXiaohongshuProjectionEntries'],
    './black-market-storage':['loadBlackMarketTheaterProjectionEntries'], './interview-magazine-memory':['loadInterviewMagazineProjectionEntries'],
    './cocreate-memory':['loadCoCreateProjectionEntries'], './chat-offline-storage':['loadChatOfflineProjectionEntries'],
    './checkphone-storage':['loadCheckPhoneProjectionEntries'], './custom-app-storage':['loadCustomAppTimelineEntries'],
  })) deps[path] = Object.fromEntries(names.map(name => [name, () => []]));
  const assemblerSource = fs.readFileSync('lib/short-term-assembler.ts','utf8');
  const optimized = moduleUnderTest('lib/short-term-assembler.ts', deps);
  const complete = moduleUnderTest('lib/short-term-assembler.ts', deps, '', assemblerSource
    .replace('const cutoff = historyBudgetCutoff(promptHistory, memConfig.shortTermTokenBudget, options?.includeNativeToolHistory);','const cutoff: string | undefined = undefined;')
    .replace('directPreviewOnly: appId === "chat" && !options?.includeDirectChatEntries,','directPreviewOnly: false,'));
  let scenarios = 0;
  for (const malformed of [false,true]) for (const budget of [0,4,40,100,400,2000]) for (const appId of ['chat','vn','group_chat']) for (const includeNativeToolHistory of [false,true]) for (const disable of [false,true]) {
    scenarioBudget = budget; allowedSources = disable ? {chat:false} : {};
    scenarioMessages = Array.from({length:170}, (_,i) => ({id:'case'+i,sessionId:i%3?'direct':'group',role:i%11===0?'system':i%2?'assistant':'user',
      content:i%13===0?'':'内容'+i,order:i,createdAt:malformed&&i===30?'invalid':new Date(1700000000000+Math.floor(i/4)*1000).toISOString(),
      mediaType:i%17===0?'tool_notice':i%19===0?'reading_discuss':i%11===0?'music_notify':undefined,
      nativeToolCalls:i%23===0?[{id:'call'}]:undefined,isRetracted:i%29===0,mediaData:{readingBookTitle:'书籍'} }));
    // Imported order may differ from timestamps; both paths must preserve ties.
    scenarioMessages[75].createdAt = scenarioMessages[20].createdAt;
    const history = scenarioMessages.filter(m=>m.sessionId==='direct');
    const options = {history,includeNativeToolHistory,userName:'用户'};
    assert.deepEqual(JSON.parse(JSON.stringify(optimized.prepareShortTermContext('c',appId,options))),
      JSON.parse(JSON.stringify(complete.prepareShortTermContext('c',appId,options))), `assembler ${JSON.stringify({malformed,budget,appId,includeNativeToolHistory,disable})}`);
    scenarios++;
  }
  console.log(`PASS: ${scenarios} complete-history / optimized prompt equivalence scenarios`);

  // A read begun while a write is pending must not remain cached after commit.
  let finishWrite, reads = 0, storedContent = '旧记忆';
  const fakeMemoryDb = { close() {}, transaction() { const tx = {objectStore: () => ({put() {}})}; finishWrite = () => tx.oncomplete(); return tx; } };
  const memories = moduleUnderTest('lib/memory-storage.ts', {}, `
openDb = async () => exports.__db;
readMemoryEntries = async () => exports.__read();
`);
  memories.__db = fakeMemoryDb;
  memories.__read = () => { reads++; return [{id:'memory',content:storedContent}]; };
  const writing = memories.saveMemoryEntry({id:'memory'});
  await Promise.resolve();
  assert.equal((await memories.loadMemoryEntries('c'))[0].content, '旧记忆');
  storedContent = '新记忆'; finishWrite(); await writing;
  assert.equal((await memories.loadMemoryEntries('c'))[0].content, '新记忆');
  await memories.loadMemoryEntries('c'); assert.equal(reads, 2, 'reuse settled read until the next mutation');

  // Execute the actual script injected into DIY iframes, with browser events mocked.
  const diy = moduleUnderTest('components/widgets/diy-widget-renderer.tsx', {}, 'exports.__bridge = injectCodeWidgetBridge;');
  const html = diy.__bridge('<html><head></head><body></body></html>', 'test-widget', {});
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const listeners = new Map(), sent = [];
  vm.runInNewContext(script, { window: {addEventListener() {}}, document: {readyState:'loading', addEventListener(name,fn) {listeners.set(name,[...(listeners.get(name)||[]),fn]);}},
    parent:{postMessage:value=>sent.push(value)}, Date, JSON, Array, Object, Math, setTimeout:()=>1, clearTimeout() {} });
  const pointer = (type,x,y,ignore=false) => {
    const event = {type,isPrimary:true,pointerType:'touch',pointerId:1,clientX:x,clientY:y,target:{closest:()=>ignore?{}:null}};
    for (const listener of listeners.get(type)||[]) listener(event);
  };
  pointer('pointerdown',100,50); pointer('pointermove',30,55); pointer('pointerup',25,55);
  assert.deepEqual(Array.from(sent,m=>m.phase),['move','end']); assert.equal(sent[1].dx,-75);
  sent.length=0; pointer('pointerdown',100,50);pointer('pointermove',98,110);pointer('pointerup',20,110); assert.equal(sent.length,0,'vertical scrolling stays in the widget');
  pointer('pointerdown',100,50,true);pointer('pointermove',20,50);pointer('pointerup',20,50);assert.equal(sent.length,0,'form controls do not turn desktop pages');
  pointer('pointerdown',100,50);pointer('pointermove',20,50);pointer('pointercancel',20,50);assert.equal(sent.at(-1).phase,'cancel');
  console.log('PASS: memory write/read cache race and DIY horizontal/vertical/input/cancel gestures');

  const kv = new Map(); const assets = new Set();
  const maps = moduleUnderTest('lib/vn-map-storage.ts', {
    './kv-db': { kvGet: key => kv.get(key), kvSet: (key, value) => kv.set(key, value), registerKvMigration() {} },
    './theme-storage': { saveThemeAssetFromBlob: async () => { const id = 'image-' + assets.size; assets.add(id); return id; }, deleteThemeAsset: async id => assets.delete(id) },
  });
  const root = await maps.addVnMap('城市', 'a', {}), child = await maps.addVnMap('室内', 'a', {});
  maps.saveVnMap({ ...child, parentId: root.id });
  maps.saveVnMap({ ...root, pins: [{ id: 'pin', name: '建筑', x: 20, y: 30, childMapId: child.id, sceneName: '大厅' }] });
  assert.throws(() => maps.saveVnMap({ ...root, parentId: child.id }), /自己的上级/);
  assert.equal(maps.loadVnMaps('other').length, 0);
  assert.equal(maps.loadVnMaps('a').find(m => m.id === root.id).pins[0].childMapId, child.id);
  await maps.deleteVnMap(root.id);
  assert.equal(maps.loadVnMaps('a')[0].parentId, undefined); assert.equal(assets.size, 1);

  // Revisions survive storage roundtrips, don't become additional timeline messages,
  // and a failed database write leaves the adopted message intact.
  let failWrite = false;
  class FakeDexie { constructor() { this.messages = { put: async value => { if (failWrite) throw Error('quota'); return value.id; } }; } version() { return { stores() {} }; } }
  const vn = moduleUnderTest('lib/vn-storage.ts', { dexie: FakeDexie }, `exports.__seed = items => { _messagesCache = items; };`);
  vn.__seed([{ id: 'answer', sessionId: 's', chapterIndex: 0, role: 'assistant', rawContent: '原文', createdAt: '2026-11-18' }]);
  await vn.saveVnMessageRevision('answer', { variants: [{ id: 'v1', rawContent: '原文' }, { id: 'v2', rawContent: '候选' }] });
  assert.equal(vn.loadVnMessagesForChapter('s', 0).length, 1); assert.equal(vn.loadVnMessagesForChapter('s', 0)[0].rawContent, '原文');
  failWrite = true; await assert.rejects(vn.saveVnMessageRevision('answer', { rawContent: '失败版本' }));
  assert.equal(vn.loadVnMessagesForChapter('s', 0)[0].rawContent, '原文');
  failWrite = false; await vn.saveVnMessageRevision('answer', { rawContent: '候选', selectedVariantId: 'v2' });
  assert.equal(vn.loadVnMessagesForChapter('s', 0)[0].rawContent, '候选');

  // Independent widget generation must update the same profile native rendering
  // prefers, instead of leaving an older tool-written profile value on screen.
  let widgetPrompt, savedProfile, savedCharacter;
  const profileEngine = moduleUnderTest('lib/widget/engine.ts', {
    '../character-storage': {loadCharacters:()=>[{id:'c',name:'角色',avatar:''}]},
    '../settings-storage': {resolveUserIdentity:()=>({name:'用户'})},
    '../chat-engine': {
      buildChatPromptMessages: async (session, history, options) => {widgetPrompt={session,history,options};return {config:{},preset:{},llmMessages:[],regexes:[]};},
      sendLLMRequest: async () => '{"text":"新的组件留言","status":"休息"}',
    },
    './storage': {loadWidgetProfileData:()=>({characterId:'c',text:'旧的实例留言'}),loadWidgetData:()=>({characterId:'c',text:'默认组件留言'}),
      saveWidgetProfileData:(id,data)=>{savedProfile={id,data};},saveWidgetData:data=>{savedCharacter=data;}},
    './output': moduleUnderTest('lib/widget/output.ts'),
  });
  await profileEngine.generateWidgetProfileContent('c','profile-c');
  assert.equal(savedProfile.id,'profile-c'); assert.equal(savedProfile.data.text,'新的组件留言');
  assert.equal(savedCharacter.characterId,'c');
  assert.equal(widgetPrompt.options.appId,'phone_widget');assert.equal(widgetPrompt.options.toolsAllowed,false);
  assert.match(widgetPrompt.history[0].content,/旧的实例留言/);

  const widget = moduleUnderTest('lib/widget/output.ts');
  assert.equal(widget.parseWidgetLineOutput('[执行动作:危险]'), null);
  assert.equal(widget.parseWidgetLineOutput('{"text":"短句","status":"休息"}').text, '短句');
  const prompts = moduleUnderTest('lib/selective-app-prompts.ts'); const preset = { prompts: [], prompt_order: [] };
  assert.equal(prompts.withSelectiveAppPrompt(preset, 'chat', ['chat']), preset);
  const extended = prompts.withSelectiveAppPrompt(preset, 'phone_widget', ['phone_widget', 'status']);
  assert.equal(preset.prompts.length, 0); assert.match(extended.prompts[0].content, /长期记忆/);
  console.log('PASS: Unicode/token compatibility, indexed chat ordering/append/edit/limits, nested map cycles/deletion, revision durability/failure, widget protocol and chat prompt isolation');
})().catch(error => { console.error(error); process.exitCode = 1; });
