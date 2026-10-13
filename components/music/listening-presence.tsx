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
 * 开发模式专用：把每个一起听相关元素的实际尺寸打印出来。
 *
 * 存在的理由：头像/环绕曾多次出现"铺满整屏"的问题，而这类问题靠读样式表推不出来
 * —— 究竟是容器没尺寸、图片没约束、还是某个祖先没被裁剪，只有实测才知道。
 * 在生产构建里由 NODE_ENV 守卫剔除。
 */
function runListeningSizeAudit() {
            const selectors = [
                ".listening-planets", ".listening-orbit", ".listening-planet",
                ".listening-avatar-pair", ".listening-avatar-pair > span",
                ".listening-member-avatar", ".listening-members", ".listening-members-overlay",
                ".music-float", ".music-float-cover-wrap", ".music-float-info",
            ];
            const room = getListeningRoom();
            const rows = selectors.map(selector => {
                const el = document.querySelector(selector);
                if (!el) return `${selector.padEnd(32)} 元素不存在（条件渲染没走到）`;
                const style = getComputedStyle(el);
                const hidden = style.display === "none";
                // 用 offsetWidth/Height 而不是 getBoundingClientRect：
                // 环绕一直在旋转，外接矩形会给出误导性的尺寸（曾量出 122×122，
                // 而父容器实际只有 52×52）。
                const h = el as HTMLElement;
                return `${selector.padEnd(32)} ${h.offsetWidth}×${h.offsetHeight}` +
                    ` display=${style.display}${hidden ? " ← 被隐藏" : ""} pos=${style.position} overflow=${style.overflow}`;
            });
            const images = [...document.querySelectorAll<HTMLImageElement>(
                ".listening-planet img,.listening-avatar-pair img,.listening-member-avatar img")].map((img, index) => {
                    const rect = img.getBoundingClientRect();
                    const style = getComputedStyle(img);
                    return `  img[${index}] 实测 ${Math.round(rect.width)}×${Math.round(rect.height)}` +
                        ` css=${style.width}×${style.height} 原图=${img.naturalWidth}×${img.naturalHeight}`;
                });
            console.log(`[一起听·尺寸] room=${room ? `${room.id} status=${room.status}` : "空！存在感不会渲染"}`);
            console.log(rows.join("\n"));
            console.log("头像 img：\n" + (images.join("\n") || "  无"));
            // 环绕与封面的相对位置：定环绕坐标只能靠实测，靠读样式推不出来
            const float = document.querySelector(".music-float");
            const cover = document.querySelector(".music-float-cover-wrap");
            if (float && cover) {
                const f = float.getBoundingClientRect();
                const c = cover.getBoundingClientRect();
                console.log("[一起听·相对位置] 以浮窗左上为原点：",
                    `浮窗 ${Math.round(f.width)}×${Math.round(f.height)}`,
                    `封面 x=${Math.round(c.left - f.left)} y=${Math.round(c.top - f.top)} ${Math.round(c.width)}×${Math.round(c.height)}`,
                    `封面中心 x=${Math.round(c.left - f.left + c.width / 2)} y=${Math.round(c.top - f.top + c.height / 2)}`);
            }
    return { room, rows, images };
}

/**
 * 列出尺寸明显异常的元素。
 *
 * 用于"某某铺满整屏"这类问题：可能是容器没尺寸、图片没被约束、也可能是某个
 * 根本没预期的元素在渲染。与其猜是哪个，不如把超过阈值的元素全列出来。
 */
function findOversizedElements(limit = 260) {
    const offenders: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("*")) {
        const rect = el.getBoundingClientRect();
        if (rect.width < limit && rect.height < limit) continue;
        const name = `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}` +
            (typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\s+/).join(".") : "");
        const style = getComputedStyle(el);
        offenders.push(
            `${name.slice(0, 78)}\n    ${Math.round(rect.width)}×${Math.round(rect.height)}` +
            ` pos=${style.position} display=${style.display} overflow=${style.overflow}`);
    }
    console.log(`[一起听·超尺寸元素] 阈值 ${limit}px，命中 ${offenders.length} 个：\n` + offenders.join("\n"));
    return offenders;
}

/**
 * 把诊断函数挂到 window 上，控制台敲一行即可核对。
 *
 * 刻意在模块加载时就挂（而不是放在组件的 effect 里）：放在 effect 里时，
 * 组件没挂载或没重渲染就找不到这个函数，控制台会报 ReferenceError ——
 * 而最需要它的场景恰恰是"界面没按预期渲染出来"，那时组件很可能就在异常状态。
 */
if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
    const w = window as unknown as Record<string, unknown>;
    w.__dshListeningAudit = runListeningSizeAudit;
    w.__dshListeningFindBig = findOversizedElements;
}

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

    // 开发模式诊断：头像/名字取不到时很难从界面上判断是"数据为空"还是"样式没生效"。
    // 放在 effect 里并只在关键值变化时打印 —— 直接写在渲染体里会每次渲染都刷一条，
    // 把控制台淹掉（这个组件在拖动/动画期间渲染很频繁）。生产构建由 NODE_ENV 守卫剔除。
    const avatar = character?.avatar;
    const userName = user?.name;
    const userAvatar = user?.avatarUrl;
    const roomId = room?.id;
    const roomStatus = room?.status;
    const characterName = character?.name;
    const sessionAlias = session?.alias;
    useEffect(() => {
        if (process.env.NODE_ENV === "production" || !roomId) return;
        console.log("[一起听·存在感]", {
            roomId, status: roomStatus,
            characterId: room?.characterId, 找到角色: !!characterName,
            角色名: characterName, 角色头像: avatar,
            会话别名: sessionAlias,
            用户名: userName, 用户头像: userAvatar,
        });
        // 只在房间与头像/名字变化时打印，避免动画期间刷屏
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [roomId, roomStatus, characterName, avatar, sessionAlias, userName, userAvatar]);

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
                    // 半径用视框单位（88 的一半再留出线长），不用 px：
                    // 环的容器在折叠/展开态是 80 / 72px，SVG 会按 viewBox 等比缩放，
                    // 写死 px 会让短线落到环外，看起来"半径不对"。
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
