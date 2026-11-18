import { kvGet, kvSet, registerKvMigration } from './kv-db';
import { saveThemeAssetFromBlob, deleteThemeAsset } from './theme-storage';

const KEY = 'ai_phone_vn_maps_v1';
registerKvMigration(KEY);
export type VnMapPin = { id: string; name: string; x: number; y: number; sceneName?: string; childMapId?: string };
export type VnMap = { id: string; name: string; characterId: string; assetId: string; parentId?: string; pins: VnMapPin[] };
export function loadVnMaps(characterId?: string): VnMap[] {
  try {
    const maps: VnMap[] = JSON.parse(kvGet(KEY) || '[]');
    return maps.filter(m => m && typeof m.id === 'string' && Array.isArray(m.pins)
      && (characterId === undefined || !m.characterId || m.characterId === characterId));
  } catch { return []; }
}
export function saveVnMap(map: VnMap): void {
  const maps = loadVnMaps();
  // Reject cyclic parent relationships, including a map parenting itself.
  let parent = map.parentId;
  const visited = new Set([map.id]);
  while (parent) {
    if (visited.has(parent)) throw new Error('地图不能成为自己的上级');
    visited.add(parent); parent = maps.find(m => m.id === parent)?.parentId;
  }
  const next = [...maps.filter(m => m.id !== map.id), map];
  for (const m of next) m.pins = m.pins.map(pin => ({ ...pin, childMapId: pin.childMapId && next.find(child => child.id === pin.childMapId)?.parentId === m.id ? pin.childMapId : undefined }));
  kvSet(KEY, JSON.stringify(next));
}
export async function addVnMap(name: string, characterId: string, file: Blob): Promise<VnMap> {
  const assetId = await saveThemeAssetFromBlob(file, 'vn_map');
  const map: VnMap = { id: crypto.randomUUID(), name, characterId, assetId, pins: [] };
  saveVnMap(map); return map;
}
export async function deleteVnMap(id: string): Promise<void> {
  const maps = loadVnMaps(), removed = maps.find(m => m.id === id);
  kvSet(KEY, JSON.stringify(maps.filter(m => m.id !== id).map(m => ({ ...m,
    parentId: m.parentId === id ? undefined : m.parentId,
    pins: m.pins.map(p => ({ ...p, childMapId: p.childMapId === id ? undefined : p.childMapId })),
  }))));
  if (removed) await deleteThemeAsset(removed.assetId);
}
