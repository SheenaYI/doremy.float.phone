import { kvGet, kvKeysWithPrefix } from './kv-db';
import { loadAllChatMessages } from './chat-storage';

/** Conservative reference check: removed feature data still protects its media. */
export async function readArchiveMediaReferences(): Promise<Map<string, Set<string>>> {
  const used = new Map<string, Set<string>>();
  function inspect(value: unknown, label: string, seen = new Set<unknown>()): void {
    if (typeof value === 'string') {
      if (!value.includes('media-store://')) return;
      for (const match of value.matchAll(/media-store:\/\/([^\s"'<>\\)\]}]+)/g)) {
        const labels = used.get(match[1]) ?? new Set<string>(); labels.add(label); used.set(match[1], labels);
      }
    } else if (value && typeof value === 'object' && !(value instanceof Blob) && !ArrayBuffer.isView(value) && !seen.has(value)) {
      seen.add(value);
      for (const item of Object.values(value)) inspect(item, label, seen);
    }
  }
  for (const message of loadAllChatMessages()) inspect(message, '聊天记录');
  const keys = kvKeysWithPrefix('');
  for (let i = 0; i < keys.length; i++) {
    inspect(kvGet(keys[i]), keys[i].includes('photo_wall') ? '历史照片墙' : keys[i].includes('diary') ? '日记' : keys[i].includes('calendar') ? '日历' : '应用配置与存档');
    if (i % 30 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
  if (!indexedDB.databases) throw new Error('当前浏览器无法完整检查媒体引用，暂不开放删除');
  const databases = await indexedDB.databases();
  const names = new Set(['AiPhoneChatDB', 'AiPhoneStoryDB', 'AiPhoneVnDB', 'AiPhoneDwellingDB', 'AiPhoneCheckPhoneDB', 'reading-db']);
  for (const database of databases) {
    if (!database.name || !names.has(database.name)) continue;
    const name = database.name;
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      request.onupgradeneeded = () => { request.transaction?.abort(); reject(new Error('存档正在变化，请刷新后重试')); };
    });
    try {
      for (const store of Array.from(db.objectStoreNames)) {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(store, 'readonly');
          const request = tx.objectStore(store).openCursor();
          request.onerror = () => reject(request.error);
          tx.onabort = () => reject(tx.error);
          request.onsuccess = () => { const cursor = request.result; if (!cursor) { resolve(); return; } inspect(cursor.value, name === 'AiPhoneChatDB' ? '聊天记录' : '创作与阅读存档'); cursor.continue(); };
        });
      }
    } finally { db.close(); }
  }
  return used;
}
