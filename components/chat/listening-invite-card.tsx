"use client";

// components/chat/listening-invite-card.tsx
// 「一起听」邀请卡片：唱片封套视觉 + 滑动手势（右滑接受 / 左滑拒绝）。
// 移植自 Yyk-Y2k/ai-virtual-phone-Y2Kversion（AGPL-3.0）的 listening-invite-card.tsx，
// 样式取自上游客 music.css 的 listening-invite-* / listening-record-* 选择器
// （署名见 README 第六节）。
//
// 与上游的差异：上游没有「退出/撤回」入口（只能等对方回应，或在浮窗里结束）。
// 本实现保留了自己补的退出按钮，放在卡片底部的一行小字里 —— 手势区负责接受/拒绝，
// 退出是次要动作，不该和手势抢主视觉。

import { useRef, useState, useSyncExternalStore } from "react";
import { Headphones } from "lucide-react";
import type { ChatMessage } from "@/lib/chat-storage";
import { getListeningRoom, subscribeListeningRoom, respondToListeningInvitation, exitListeningRoom } from "@/lib/listen-together";

const serverSnapshot = () => null;

/** 滑动位移超过这个像素数就判定为一次明确的选择（与上游一致）。 */
const SWIPE_THRESHOLD = 20;
/** 唱片默认停在封套外露出的位置；接受后滑出更多。 */
const SLIDE_REST = 27;
const SLIDE_JOINED = 70;

export function ListeningInviteCard({ msg }: { msg: ChatMessage }) {
    const room = useSyncExternalStore(subscribeListeningRoom, getListeningRoom, serverSnapshot);
    const invite = msg.mediaData?.listeningInvite;
    const [failedCover, setFailedCover] = useState<string>();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [slide, setSlide] = useState<number | null>(null);
    const drag = useRef<{ x: number; y: number; scale: number } | null>(null);

    // 房间状态优先：翻看历史时房间可能已经不在了，那时只能靠消息自己记录的 response
    // 判断终态，否则旧卡片会显示成「仍在等待」。
    const status = room?.id === invite?.roomId && room?.sessionId === msg.sessionId ? room?.status : undefined;
    const label = status === "joined" ? "已加入 · 一起听中"
        : status === "declined" || invite?.response === "declined" ? "已婉拒"
            : status === "invited" ? "等待回应"
                : invite?.response === "accepted" ? "已接受过这份邀请"
                    : invite?.initiator === "character" ? "邀请已失效"
                        : "邀请已发送";

    const cover = invite?.coverUrl && failedCover !== invite.coverUrl ? invite.coverUrl : undefined;
    // 只有「角色发出、且仍在等待」的邀请可操作；用户自己发的要等角色回应。
    const actionable = status === "invited" && invite?.initiator === "character";
    const canExit = Boolean(room && room.sessionId === msg.sessionId);
    const exitLabel = status === "invited" && invite?.initiator !== "character" ? "撤回邀请" : "结束一起听";

    const respond = async (accept: boolean) => {
        if (!actionable || busy || !invite) return;
        setBusy(true); setError("");
        try {
            await respondToListeningInvitation(invite.roomId, msg.sessionId, accept);
        } catch (failure) {
            setError(failure instanceof Error ? failure.message : "操作失败，请重试");
        } finally {
            setBusy(false);
            setSlide(null);
        }
    };

    const endDrag = () => { drag.current = null; setSlide(null); };

    // CSS 靠 data-status 驱动唱片滑动与旋转：joined/accepted 滑出并转，declined 归位。
    const visualStatus = status || (invite?.response === "declined" ? "declined" : invite?.response === "accepted" ? "accepted" : undefined);

    return (
        <div
            className="listening-invite-card listening-invite-record"
            data-status={visualStatus}
            role="group"
            aria-label={["一起听邀请", invite?.title, invite?.artist, label].filter(Boolean).join("，")}
        >
            <div className="listening-invite-heading"><Headphones size={13} strokeWidth={1.6} />一起听</div>

            <div
                className="listening-record-stage"
                role={actionable ? "button" : "img"}
                tabIndex={actionable ? 0 : undefined}
                aria-label={actionable ? "一起听邀请，向右滑动或按右箭头接受，向左滑动或按左箭头拒绝" : label}
                aria-disabled={busy || undefined}
                style={actionable ? { touchAction: "pan-y", cursor: "grab" } : undefined}
                onContextMenu={event => { if (actionable) { event.preventDefault(); event.stopPropagation(); } }}
                onClick={event => { if (actionable) event.stopPropagation(); }}
                onPointerDown={event => {
                    if (!actionable || busy || event.button !== 0) return;
                    event.stopPropagation();
                    drag.current = {
                        x: event.clientX,
                        y: event.clientY,
                        // 界面可能被整体缩放，位移要按缩放比换算回元素坐标
                        scale: event.currentTarget.getBoundingClientRect().width / event.currentTarget.offsetWidth || 1,
                    };
                    event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={event => {
                    if (!drag.current) return;
                    const dx = (event.clientX - drag.current.x) / drag.current.scale;
                    const dy = (event.clientY - drag.current.y) / drag.current.scale;
                    // 明显的纵向滑动视为滚动页面，放弃这次手势
                    if (Math.abs(dy) > 16 && Math.abs(dy) > Math.abs(dx)) { endDrag(); return; }
                    setSlide(Math.max(0, Math.min(SLIDE_JOINED, SLIDE_REST + dx)));
                }}
                onPointerUp={event => {
                    if (!drag.current) return;
                    event.stopPropagation();
                    const dx = (event.clientX - drag.current.x) / drag.current.scale;
                    endDrag();
                    if (Math.abs(dx) >= SWIPE_THRESHOLD) void respond(dx > 0);
                }}
                onPointerCancel={endDrag}
                onLostPointerCapture={endDrag}
                onKeyDown={event => {
                    if (!actionable || !["ArrowRight", "ArrowLeft", "Enter", " "].includes(event.key)) return;
                    event.preventDefault(); event.stopPropagation();
                    void respond(event.key !== "ArrowLeft");
                }}
            >
                <div
                    className="listening-record-slide"
                    style={slide === null ? undefined : { transform: `translateX(${slide}px)`, transition: "none" }}
                >
                    <div className="listening-record-disc">
                        <span className="listening-record-label">
                            {cover && <img src={cover} alt="" draggable={false} onError={() => setFailedCover(cover)} />}
                        </span>
                        <i className="listening-record-spindle" />
                    </div>
                </div>
                <div className="listening-record-sleeve">
                    {cover
                        ? <img src={cover} alt="" draggable={false} onError={() => setFailedCover(cover)} />
                        : <span className="listening-record-empty"><Headphones size={32} strokeWidth={1} /><span>FOR YOU</span></span>}
                    <span className="listening-record-sleeve-edge" />
                </div>
            </div>

            <div className="listening-invite-copy">
                <strong>{invite?.title || "未指定歌曲"}</strong>
                {invite?.artist && <small>{invite.artist}</small>}
            </div>

            <div className="listening-invite-footer">
                <span role="status">{busy ? "正在连接…" : error || label}</span>
                {canExit && (
                    <button
                        type="button"
                        className="ui-btn rounded-[14px] px-2"
                        style={{ fontSize: 10 }}
                        disabled={busy}
                        onClick={event => {
                            event.stopPropagation();
                            setBusy(true);
                            setError("");
                            try {
                                exitListeningRoom(msg.sessionId);
                            } catch (failure) {
                                setError(failure instanceof Error ? failure.message : "操作失败，请重试");
                            } finally {
                                setBusy(false);
                            }
                        }}
                    >
                        {exitLabel}
                    </button>
                )}
            </div>

            {actionable && !busy && !error && (
                <div className="listening-invite-gesture-hint" role="status">右滑接受 · 左滑婉拒</div>
            )}
        </div>
    );
}
