"use client";

// components/widgets/music-marquee.tsx
// 歌名滚动：文字比容器宽时才滚动，来回往返而不是无限单方向跑。
// 移植自 Yyk-Y2k/ai-virtual-phone-Y2Kversion（AGPL-3.0，署名见 README 第六节）。
//
// 只在真的放不下时才动：短歌名滚动反而更难读。宽度用 ResizeObserver 量，
// 这样容器尺寸变化（展开/收起浮窗、旋转屏幕）后仍然正确。

import { useEffect, useRef, useState, type CSSProperties } from "react";

export function MusicMarquee({ text }: { text: string }) {
    const frame = useRef<HTMLSpanElement>(null);
    const content = useRef<HTMLSpanElement>(null);
    const [distance, setDistance] = useState(0);

    useEffect(() => {
        const measure = () => setDistance(Math.max(0, (content.current?.scrollWidth || 0) - (frame.current?.clientWidth || 0)));
        measure();
        const observer = new ResizeObserver(measure);
        if (frame.current) observer.observe(frame.current);
        if (content.current) observer.observe(content.current);
        return () => observer.disconnect();
    }, [text]);

    return (
        <span
            ref={frame}
            className="music-marquee"
            title={text}
            // 留 2px 容差：亚像素取整会让刚好放得下的文字也判为溢出
            data-overflow={distance > 2 || undefined}
            style={{
                // 滚动距离与时长都按实际溢出量算：长标题滚得久一点，速度才一致
                "--music-marquee-end": `${-distance}px`,
                "--music-marquee-duration": `${Math.max(7, distance / 22 + 4)}s`,
            } as CSSProperties}
        >
            <span key={text} ref={content} className="music-marquee-text">{text}</span>
        </span>
    );
}
