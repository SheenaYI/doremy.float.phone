"use client";

// components/music/chat-music-panel.tsx
// 聊天室里的「一起听」邀请入口。
// 移植自 Yyk-Y2k/ai-virtual-phone-Y2Kversion（AGPL-3.0）的同名组件。
//
// 与原版的差异：原版还承载歌单浏览/点歌（依赖上游一整套音乐面板样式）。
// 这里只做「邀请一起听」这一件事 —— 用户侧邀请是这个功能的入口，
// 歌单浏览在音乐 App 里已经有了，没必要在聊天弹窗里再做一遍。
// 邀请本身由 chat-room 通过 onInvite 注入，面板只负责展示与触发。

import { Disc3, Headphones, X } from "lucide-react";
import { useMusicPlayerOptional } from "@/lib/music-context";

type ChatMusicPanelProps = {
    name: string;
    avatar?: string;
    isGroup?: boolean;
    busy?: boolean;
    onInvite: () => void;
    onClose: () => void;
};

export function ChatMusicPanel({ name, avatar, isGroup, busy, onInvite, onClose }: ChatMusicPanelProps) {
    // 用「可选」版本：本面板可能被放在没有 MusicProvider 的容器里渲染（例如独立预览），
    // 那种情况下应当只是显示"当前没有在放的歌"，而不是抛错把整棵子树打挂。
    const music = useMusicPlayerOptional();
    const track = music?.currentTrack ?? null;
    const disabled = Boolean(busy) || Boolean(isGroup);

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div
                className="w-[320px] max-w-[calc(100vw-32px)] rounded-[24px] text-[var(--c-text)] overflow-hidden flex flex-col"
                style={{ background: "var(--c-panel)", border: "1px solid var(--c-panel-border)" }}
                onClick={(event) => event.stopPropagation()}
            >
                <div className="px-4 pt-4 pb-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                        <span
                            className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 overflow-hidden"
                            style={{ background: "var(--c-card)" }}
                        >
                            {avatar
                                ? <img src={avatar} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                : <Headphones size={20} strokeWidth={1.4} style={{ color: "var(--c-icon-green, #18A957)" }} />}
                        </span>
                        <div className="min-w-0">
                            <div className="ts-15 font-semibold truncate">一起听</div>
                            <div className="ts-12 truncate" style={{ color: "var(--c-icon)" }}>与 {name}</div>
                        </div>
                    </div>
                    <button type="button" className="ui-btn rounded-[16px] px-2" onClick={onClose} aria-label="关闭">
                        <X size={16} />
                    </button>
                </div>

                <div className="px-4 pb-4 flex flex-col gap-3">
                    <div
                        className="flex items-center gap-3 rounded-[16px] p-3"
                        style={{ background: "var(--c-card)", border: "1px solid var(--c-panel-border)" }}
                    >
                        <span
                            className="rounded-[10px] overflow-hidden shrink-0 flex items-center justify-center"
                            style={{ width: 44, height: 44, background: "var(--c-page-body-bg)" }}
                        >
                            {track?.coverUrl
                                ? <img src={track.coverUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                : <Disc3 size={22} strokeWidth={1.2} style={{ color: "var(--c-icon)" }} />}
                        </span>
                        <span className="flex flex-col min-w-0 gap-[2px]">
                            <span className="ts-13 font-medium truncate" title={track?.title || ""}>
                                {track?.title || "当前没有在放的歌"}
                            </span>
                            <span className="ts-12 truncate" style={{ color: "var(--c-icon)" }}>
                                {track?.artist || "邀请后可以在音乐 App 里点歌"}
                            </span>
                        </span>
                    </div>

                    {isGroup && (
                        <div className="ts-12" style={{ color: "var(--c-icon)" }}>一起听只能在私聊里发起。</div>
                    )}
                    {busy && !isGroup && (
                        <div className="ts-12" style={{ color: "var(--c-icon)" }}>对方正在回复，请稍后再邀请。</div>
                    )}

                    <button
                        type="button"
                        className="ui-btn ui-btn-success rounded-[18px] w-full"
                        disabled={disabled}
                        onClick={onInvite}
                    >
                        {busy ? "请稍后…" : "邀请一起听"}
                    </button>
                </div>
            </div>
        </div>
    );
}
