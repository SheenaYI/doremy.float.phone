export type LyricCardColor = { background: string; color: string };
export const DEFAULT_LYRIC_COLOR: LyricCardColor = { background: "#eadde3", color: "#19171b" };

type ColorBucket = { count: number; r: number; g: number; b: number };
const average = (bucket: ColorBucket) => [bucket.r, bucket.g, bucket.b].map(n => n / bucket.count);
function isColorful(rgb: number[]): boolean {
    const max = Math.max(...rgb), min = Math.min(...rgb);
    // Reject near-black, near-white, and low-saturation greys.
    return max > 40 && (max + min) / 2 < 240 && (max - min) / max >= .18;
}

export function lyricColorFromPixels(pixels: ArrayLike<number>): LyricCardColor {
    const buckets = new Map<string, ColorBucket>();
    let total = 0;
    for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] < 128) continue;
        const [r, g, b] = [pixels[i], pixels[i + 1], pixels[i + 2]];
        const key = `${r >> 5},${g >> 5},${b >> 5}`;
        const bucket = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0 };
        bucket.count++; bucket.r += r; bucket.g += g; bucket.b += b;
        total++;
        buckets.set(key, bucket);
    }
    // Merge nearby shades against fixed seeds, avoiding chains that gradually
    // merge unrelated colours. Keep neutral and colourful candidates separate.
    const ranked = [...buckets.values()].sort((a, b) => b.count - a.count || a.r / a.count - b.r / b.count || a.g / a.count - b.g / b.count || a.b / a.count - b.b / b.count);
    const groups: { seed: number[]; bucket: ColorBucket }[] = [];
    for (const bucket of ranked) {
        const rgb = average(bucket);
        let closest: typeof groups[number] | undefined;
        let distance = 48 ** 2;
        for (const group of groups) {
            if (isColorful(group.seed) !== isColorful(rgb)) continue;
            const d = rgb.reduce((sum, n, i) => sum + (n - group.seed[i]) ** 2, 0);
            if (d <= distance) { closest = group; distance = d; }
        }
        if (closest) {
            closest.bucket.count += bucket.count;
            closest.bucket.r += bucket.r; closest.bucket.g += bucket.g; closest.bucket.b += bucket.b;
        } else groups.push({ seed: rgb, bucket: { ...bucket } });
    }
    const candidates = groups.map(group => group.bucket).sort((a, b) => b.count - a.count);
    const main = candidates.slice(0, 3).find(bucket => bucket.count / total >= .05 && isColorful(average(bucket))) ?? candidates[0];
    if (!main) return DEFAULT_LYRIC_COLOR;
    const rgb = [main.r, main.g, main.b].map(n => Math.round(n / main.count));
    const linear = rgb.map(n => n / 255 <= .04045 ? n / 255 / 12.92 : Math.pow((n / 255 + .055) / 1.055, 2.4));
    const luminance = .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2];
    return { background: `rgb(${rgb.join(",")})`, color: luminance > .179 ? "#000" : "#fff" };
}

const cache = new Map<string, Promise<LyricCardColor>>();
export function extractLyricCardColor(url?: string): Promise<LyricCardColor> {
    if (!url || typeof window === "undefined") return Promise.resolve(DEFAULT_LYRIC_COLOR);
    const existing = cache.get(url);
    if (existing) return existing;
    const promise = new Promise<LyricCardColor>(resolve => {
        const image = new Image();
        image.crossOrigin = "anonymous";
        const timeout = window.setTimeout(() => resolve(DEFAULT_LYRIC_COLOR), 5000);
        const finish = (color: LyricCardColor) => { clearTimeout(timeout); resolve(color); };
        image.onerror = () => finish(DEFAULT_LYRIC_COLOR);
        image.onload = () => {
            try {
                const canvas = document.createElement("canvas"); canvas.width = 32; canvas.height = 32;
                const context = canvas.getContext("2d");
                if (!context) return finish(DEFAULT_LYRIC_COLOR);
                context.drawImage(image, 0, 0, 32, 32);
                finish(lyricColorFromPixels(context.getImageData(0, 0, 32, 32).data));
            } catch { finish(DEFAULT_LYRIC_COLOR); }
        };
        image.src = url;
    });
    if (cache.size >= 64) cache.delete(cache.keys().next().value!);
    cache.set(url, promise);
    return promise;
}
