"use client";

// components/chat/listening-invite-card.tsx
// 「一起听」邀请卡片。
// 移植自 Yyk-Y2k/ai-virtual-phone-Y2Kversion（AGPL-3.0）的 listening-invite-card.tsx。
//
// 与原版的差异：原版用滑动手势（右滑接受 / 左滑拒绝）配唱片滑动动画，那套交互依赖
// 上游 music.css 里一百多处强耦合样式（与本仓库已分叉的音乐样式表交错分布）。
// 这里先用两个明确按钮把双向邀请的流程跑通 —— 流程正确与否可以被验证，
// 而手势动画只影响观感，可以作为第二步单独补。

import { useState, useSyncExternalStore } from "react";
import { Disc3, Headphones } from "lucide-react";
import type { ChatMessage } from "@/lib/chat-storage";
import { getListeningRoom, subscribeListeningRoom, respondToListeningInvitation } from "@/lib/listen-together";

const serverSnapshot = () => null;

export function ListeningInviteCard({ msg }: { msg: ChatMessage }) {
    const room = useSyncExternalStore(subscribeListeningRoom, getListeningRoom, serverSnapshot);
    const invite = msg.mediaData?.listeningInvite;
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [failedCover, setFailedCover] = useState<string>();

    // 房间状态优先：卡片可能是在房间结束后才被渲染的（翻历史记录），
    // 那时 room 已经不是这一条，只能靠消息自己记录的 response 判断终态。
    const status = room?.id === invite?.roomId && room?.sessionId === msg.sessionId ? room?.status : undefined;
    const label = status === "joined" ? "已加入 · 一起听中"
        : status === "declined" || invite?.response === "declined" ? "已婉拒"
            : status === "invited" ? "等待回应"
                : invite?.response === "accepted" ? "已接受过这份邀请"
                    : invite?.initiator === "character" ? "邀请已失效"
                        : "邀请已发送";

    const cover = invite?.coverUrl && failedCover !== invite.coverUrl ? invite.coverUrl : undefined;
    // 只有「角色发出、且仍在等待」的邀请才可操作；用户自己发的要等角色回应。
    const actionable = status === "invited" && invite?.initiator === "character";

    const respond = async (accept: boolean) => {
        if (!actionable || busy || !invite) return;
        setBusy(true); setError("");
        try {
            await respondToListeningInvitation(invite.roomId, msg.sessionId, accept);
        } catch (failure) {
            setError(failure instanceof Error ? failure.message : "操作失败，请重试");
        } finally {
            setBusy(false);
        }
    };

    const visualStatus = status || (invite?.response === "declined" ? "declined" : invite?.response === "accepted" ? "accepted" : undefined);

    return (
        <div
            className="ui-list-card-expandable listening-invite-card"
            data-status={visualStatus}
            role="group"
            aria-label={["一起听邀请", invite?.title, invite?.artist, label].filter(Boolean).join("，")}
            style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10, maxWidth: 260 }}
        >
            <div className="flex items-center gap-3">
                <span
                    className="rounded-[8px] overflow-hidden shrink-0 flex items-center justify-center"
                    style={{ width: 52, height: 52, background: "var(--c-card)", border: "1px solid var(--c-panel-border)" }}
                >
                    {cover
                        ? <img src={cover} alt="" draggable={false} onError={() => setFailedCover(cover)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        : <Headphones size={26} strokeWidth={1.2} style={{ color: "var(--c-icon-green, #18A957)" }} />}
                </span>
                <span className="flex flex-col min-w-0 gap-[2px]">
                    <span className="flex items-center gap-1 ts-12" style={{ color: "var(--c-icon-green, #18A957)" }}>
                        <Disc3 size={12} /> 一起听
                    </span>
                    <span className="ts-14 font-medium truncate" style={{ color: "var(--c-text)" }} title={invite?.title || ""}>
                        {invite?.title || "未指定歌曲"}
                    </span>
                    {invite?.artist && (
                        <span className="ts-12 truncate" style={{ color: "var(--c-icon)" }}>{invite.artist}</span>
                    )}
                </span>
            </div>

            <div className="ts-12" style={{ color: "var(--c-icon)" }}>{label}</div>

            {actionable && (
                <div className="flex gap-2">
                    <button
                        type="button"
                        className="ui-btn ui-btn-success flex-1 rounded-[16px]"
                        disabled={busy}
                        onClick={() => void respond(true)}
                    >
                        {busy ? "处理中…" : "接受"}
                    </button>
                    <button
                        type="button"
                        className="ui-btn flex-1 rounded-[16px]"
                        disabled={busy}
                        onClick={() => void respond(false)}
                    >
                        婉拒
                    </button>
                </div>
            )}

            {error && <div className="ts-12" style={{ color: "var(--c-danger, #f87171)" }} role="status">{error}</div>}
        </div>
    );
}
