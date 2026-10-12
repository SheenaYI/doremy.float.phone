// lib/music-song-match.ts
// 歌名/歌手匹配：把角色分享的歌名（可能带歌手）匹配到真实曲库条目。
// 移植自 Yyk-Y2k/ai-virtual-phone-Y2Kversion（AGPL-3.0）。

/**
 * 归一化：NFKC 消除全角/半角差异，转小写，去掉所有空白与标点。
 *
 * 之所以去标点：角色输出的歌名常带书名号、引号、破折号（《起风了》、"晴天"），
 * 而曲库里的标题是干净的。不做这一步会大量匹配失败。
 */
const normalized = (value: string) => value.normalize("NFKC").toLocaleLowerCase().replace(/[\s\p{P}]/gu, "");

/** 没给歌手时，保留搜索排序里命中精确标题的那一条。 */
export function matchesSharedSong(item: { title: string; artist: string }, title: string, artist?: string): boolean {
    if (!normalized(title) || normalized(item.title) !== normalized(title)) return false;
    if (!artist?.trim()) return true;
    // 曲库的 artist 可能是「A / B / C」这种多歌手串，逐个比对
    return normalized(item.artist) === normalized(artist)
        || item.artist.split(/\s*[/、,;&]\s*/).some(name => normalized(name) === normalized(artist));
}
