// components/music/listening-presence.tsx
// 「一起听」的存在感：正在一起听的提示、成员面板与环形频谱。
// 移植自 Yyk-Y2k/ai-virtual-phone-Y2Kversion（AGPL-3.0，署名见 README 第六节）。
//
// 与原版的差异：上游用 lib/chat-session-avatar.ts 那套「聊天内角色头像覆盖」存储
// 解析头像。本仓库没有该机制（聊天里直接用 character.avatar），因此这里也直接取，
// 不为一个装饰性头像引入一层新的存储。

"use client";

import { useEffect, useState, useSyncExternalStore, type CSSProperties } from "react";
import { X } from "lucide-react";
import { getListeningRoom, subscribeListeningRoom, exitListeningRoom } from "@/lib/listen-together";
import { loadCharacters } from "@/lib/character-storage";
import { loadChatSessions } from "@/lib/chat-storage";
import { resolveUserIdentity } from "@/lib/settings-storage";
import { getChatImageFromIndexedDB } from "@/lib/chat-asset-storage";
import { useMusicPlayerOptional } from "@/lib/music-context";

const serverSnapshot = () => null;

/**
 * 当前共听状态。
 *
 * 订阅房间变化与几个会影响展示的外部事件（角色/会话/绑定更新），
 * 因为角色名与头像可能在这些事件后变化。
 */
export function useListeningPresence() {
    const [, refresh] = useState(0);
    useEffect(() => {
        const update = () => refresh(value => value + 1);
        // settings-bindings-updated 由 subscribeListeningRoom 已经订阅，这里不重复
        const events = ["chat-characters-updated", "chat-sessions-updated", "chat-messages-updated"];
        events.forEach(event => window.addEventListener(event, update));
        return () => events.forEach(event => window.removeEventListener(event, update));
    }, []);

    const room = useSyncExternalStore(subscribeListeningRoom, getListeningRoom, serverSnapshot);
    const character = room ? loadCharacters().find(c => c.id === room.characterId) : null;
    const session = room ? loadChatSessions().find(s => s.id === room.sessionId) : null;
    const user = resolveUserIdentity();

    return {
        // 被婉拒的房间不再展示存在感：那不是"在一起听"
        room: room?.status === "declined" ? null : room,
        name: session?.alias || character?.name || "对方",
        avatar: character?.avatar || undefined,
        userName: user?.name || "你",
        userAvatar: user?.avatarUrl,
    };
}

/** 头像：支持 asset:// 引用（需从 IndexedDB 取回），取不到时退化为名字首字。 */
export function ListeningAvatar({ src, name }: { src?: string | null; name: string }) {
    const [resolved, setResolved] = useState<string | null>(null);

    useEffect(() => {
        let alive = true;
        setResolved(null);
        if (src) {
            if (/^(https?:|data:|blob:|\/)/.test(src)) setResolved(src);
            else {
                getChatImageFromIndexedDB(src.replace(/^asset:\/\//, ""))
                    .then(value => { if (alive) setResolved(value); })
                    .catch(() => { /* 取不到就显示首字 */ });
            }
        }
        return () => { alive = false; };
    }, [src]);

    return resolved
        ? <img src={resolved} alt="" draggable={false} onError={() => setResolved(null)} />
        : <span>{name.slice(0, 1)}</span>;
}

/**
 * 环形频谱。
 *
 * 64 根固定角度的短线，长度按正弦分布固定下来 —— 只让长度呼吸，
 * 环与颜色都不旋转：这是装饰，不是数据可视化，稳定比"动感"重要。
 */
const spectrumBars = Array.from({ length: 64 }, (_, index) => {
    const angle = index * Math.PI * 2 / 64;
    return {
        rotation: index * 360 / 64,
        length: 3 + 5 * (.5 + .5 * Math.sin(angle * 3 + .8)) ** 2,
        delay: -.7 * (.5 + .5 * Math.sin(angle * 2)) - .21 * Math.cos(angle * 5),
        duration: 1.1 + .25 * (.5 + .5 * Math.cos(angle * 3)),
    };
});

function ListeningWaveRing() {
    return (
        <svg className="listening-ring" viewBox="0 0 88 88" fill="none">
            <circle className="listening-ring-base" cx="44" cy="44" r="34" />
            <g className="listening-wave-window listening-spectrum">
                {spectrumBars.map((bar, index) => (
                    <g key={index} transform={`translate(44 44) rotate(${bar.rotation}) translate(0 -32)`}>
                        <line
                            className="listening-spectrum-bar"
                            x1="0" y1="0" x2="0" y2={-bar.length}
                            style={{ "--spectrum-delay": `${bar.delay}s`, "--spectrum-duration": `${bar.duration}s` } as CSSProperties}
                        />
                    </g>
                ))}
            </g>
        </svg>
    );
}

/** 封面上的双头像环绕：只在真的在一起听且音乐在放时环绕。 */
export function ListeningPlanets({ presence, playing }: { presence: ReturnType<typeof useListeningPresence>; playing: boolean }) {
    if (!presence.room) return null;
    return (
        <div className="listening-planets" aria-hidden="true" data-orbiting={presence.room.status === "joined" && playing ? "true" : "false"}>
            <ListeningWaveRing />
            <span className="listening-orbit">
                <span className="listening-planet"><ListeningAvatar src={presence.userAvatar} name={presence.userName} /></span>
            </span>
            <span className="listening-orbit listening-orbit-char">
                <span className="listening-planet"><ListeningAvatar src={presence.avatar} name={presence.name} /></span>
            </span>
        </div>
    );
}

/**
 * 播放器里的一起听入口：一个按钮 + 成员面板。
 *
 * 面板内容刻意做得简单（两个人是谁、对方状态、结束按钮）：
 * 一起听只有两个参与者，做重了反而看不出重点。
 */
export function ListeningPlayerPresence() {
    const presence = useListeningPresence();
    const player = useMusicPlayerOptional();
    const [open, setOpen] = useState(false);
    const room = presence.room;

    // 换房间时收起面板，避免面板里还显示上一个房间的成员
    useEffect(() => setOpen(false), [room?.id]);

    if (!room) return null;
    const label = room.status === "invited" ? `等待${presence.name}加入` : `正在和${presence.name}一起听`;

    return (
        <>
            <button className="listening-player-presence" onClick={() => setOpen(true)} aria-label={`${label}，查看成员`}>
                <span className="listening-avatar-pair">
                    <span><ListeningAvatar src={presence.userAvatar} name={presence.userName} /></span>
                    <span><ListeningAvatar src={presence.avatar} name={presence.name} /></span>
                </span>
                <span>{label}</span>
            </button>
            {open && (
                <div
                    className="listening-members-overlay"
                    onClick={() => setOpen(false)}
                    onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setOpen(false); } }}
                >
                    <div
                        className="listening-members"
                        role="dialog"
                        aria-modal="true"
                        aria-label="一起听成员"
                        onClick={event => event.stopPropagation()}
                        onKeyDown={event => {
                            if (event.key !== "Tab") return;
                            // 焦点锁在面板内，否则 Tab 会跑到被遮住的界面上
                            const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>("button");
                            const first = buttons[0], last = buttons[buttons.length - 1];
                            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
                            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
                        }}
                    >
                        <header>
                            <strong>一起听</strong>
                            <button autoFocus aria-label="关闭成员面板" onClick={() => setOpen(false)}><X size={20} /></button>
                        </header>
                        <div className="listening-member">
                            <span className="listening-member-avatar"><ListeningAvatar src={presence.userAvatar} name={presence.userName} /></span>
                            <span>{presence.userName}<small>你</small></span>
                        </div>
                        <div className="listening-member">
                            <span className="listening-member-avatar"><ListeningAvatar src={presence.avatar} name={presence.name} /></span>
                            <span>
                                {presence.name}
                                <small>{room.status === "invited" ? "邀请中" : player?.isPlaying ? "一起听中" : "音乐已暂停"}</small>
                            </span>
                        </div>
                        <button
                            className="listening-end"
                            onClick={() => {
                                // 面板可能对着一个已经换掉的房间，落动作前再确认一次
                                if (getListeningRoom()?.id !== room.id) return;
                                exitListeningRoom(room.sessionId);
                                setOpen(false);
                            }}
                        >
                            {room.status === "invited" ? "取消邀请" : "结束一起听"}
                        </button>
                    </div>
                </div>
            )}
        </>
    );
}
