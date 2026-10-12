// lib/music-share-resolution.ts
// 把角色分享的「歌名|歌手」解析成真实曲目，用于邀请卡片与一起听。
// 移植自 Yyk-Y2k/ai-virtual-phone-Y2Kversion（AGPL-3.0）。

import { unifiedSearch, type UnifiedSearchResult } from "./music-service";
import type { MusicTrack } from "./music-storage";
import { matchesSharedSong } from "./music-song-match";

/** 从搜索结果里挑出与分享信息匹配的那一条。 */
export function selectSharedSong(results: UnifiedSearchResult[], title: string, artist?: string) {
    return results.find(item => matchesSharedSong(item, title, artist)) || null;
}

export async function resolveSharedSong(title: string, artist?: string): Promise<MusicTrack | null> {
    // 只按歌名搜：本地曲库也参与，而「歌名 歌手」组合查询会漏掉本地的精确命中。
    let match = selectSharedSong(await unifiedSearch(title), title, artist);
    if (!match && artist?.trim()) match = selectSharedSong(await unifiedSearch(`${title} ${artist}`), title, artist);

    if (match?.localTrack) {
        const track = match.localTrack;
        // blob: 地址在下次会话就失效了，存进消息里没有意义，只保留可持久化的封面。
        return { ...track, coverUrl: track.coverUrl?.startsWith("blob:") ? undefined : track.coverUrl };
    }

    const song = match?.neteaseResult;
    if (!song) return null;
    return {
        id: `netease_${song.id}`,
        title: song.name,
        artist: song.artists,
        album: song.album,
        duration: song.duration / 1000,
        coverUrl: song.coverUrl,
        liked: false,
        addedAt: new Date().toISOString(),
    };
}
