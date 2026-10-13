import type { TimedLyric } from "./music-listening";

export function lyricRange(lines: TimedLyric[], anchor: number, end: number): TimedLyric[] {
    return lines.slice(Math.max(0, Math.min(anchor, end)), Math.max(anchor, end) + 1).filter(line => line.text.trim());
}

export function activeLyricIndex(lines: TimedLyric[], time: number): number {
    let low = 0, high = lines.length;
    while (low < high) {
        const mid = (low + high) >>> 1;
        if (lines[mid].time <= time) low = mid + 1;
        else high = mid;
    }
    return low - 1;
}
