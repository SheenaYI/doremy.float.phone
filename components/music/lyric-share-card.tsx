"use client";
import { useEffect, useState } from "react";
import { DEFAULT_LYRIC_COLOR, extractLyricCardColor } from "@/lib/lyric-card-color";
import styles from "./lyric-share-card.module.css";

export type LyricShareCardData = { title: string; artist: string; text: string; coverUrl?: string };
export function LyricShareCard({ title, artist, text, coverUrl, onPlay }: LyricShareCardData & { onPlay?: () => void }) {
    const [palette, setPalette] = useState(DEFAULT_LYRIC_COLOR);
    const [failed, setFailed] = useState<string>();
    useEffect(() => {
        let alive = true;
        setPalette(DEFAULT_LYRIC_COLOR);
        extractLyricCardColor(coverUrl).then(color => { if (alive) setPalette(color); });
        return () => { alive = false; };
    }, [coverUrl]);
    return <article className={styles.card} style={palette} aria-label={`歌词分享：${title}`}>
        <div className={styles.header}>
            {onPlay ? <button type="button" className={styles.coverButton} aria-label={`播放音乐：${title}`} onClick={e => { e.stopPropagation(); onPlay(); }}>
                {coverUrl && failed !== coverUrl ? <img src={coverUrl} alt="专辑封面" onError={() => setFailed(coverUrl)} /> : <span className={styles.fallback}>{title.slice(0, 1)}</span>}
            </button> : coverUrl && failed !== coverUrl ? <img src={coverUrl} alt="专辑封面" onError={() => setFailed(coverUrl)} /> : <span className={styles.fallback}>{title.slice(0, 1)}</span>}
            <div><strong>{title}</strong><span>{artist}</span></div>
        </div>
        <div className={styles.lyrics}>{text}</div>
        <footer className={styles.brand}><svg aria-hidden="true" width="15" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M17.05 12.54c.03 3.23 2.83 4.3 2.86 4.31-.02.08-.45 1.54-1.48 3.05-.9 1.3-1.83 2.6-3.3 2.63-1.44.03-1.9-.85-3.55-.85s-2.17.82-3.54.88c-1.42.05-2.5-1.42-3.4-2.72-1.85-2.67-3.27-7.55-1.37-10.85.94-1.64 2.62-2.68 4.44-2.7 1.39-.03 2.7.93 3.55.93.85 0 2.45-1.15 4.13-.98.7.03 2.67.28 3.93 2.12-.1.06-2.35 1.37-2.27 4.18ZM14.34 4.47c.75-.91 1.25-2.18 1.11-3.44-1.08.04-2.39.72-3.16 1.63-.7.8-1.32 2.1-1.15 3.34 1.2.09 2.42-.61 3.2-1.53Z" /></svg>Apple Music</footer>
    </article>;
}
