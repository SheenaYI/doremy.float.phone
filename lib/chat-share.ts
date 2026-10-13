import type { MusicListeningContext } from "./music-listening";

export type MusicChatSharePayload = {
    type: "music";
    title: string;
    artist: string;
    /** 封面地址：分享歌词卡时用来取色（背景与文字色取自封面）。 */
    coverUrl?: string;
    /** share = 分享整首并附歌词卡；quote = 引用歌词作为对话内容。 */
    lyricMode?: "share" | "quote";
    /**
     * 用户选中的歌词上下文。带上它时，聊天里这条分享会渲染成取色歌词卡，
     * 而不是普通音乐分享卡；之后角色在后续对话里也能看到这段歌词。
     */
    listeningContext?: MusicListeningContext;
};

export type XiaohongshuNoteChatSharePayload = {
    type: "xiaohongshu_note";
    authorName: string;
    title: string;
    body: string;
    description?: string;
    noteType: "post" | "video";
    tags?: string[];
    imageAssetId?: string;
    coverIcon?: string;
    tone?: string;
};

export type ChatSharePayload = MusicChatSharePayload | XiaohongshuNoteChatSharePayload;

function compactShareText(value: string | undefined, fallback: string): string {
    const text = (value || "").replace(/\s+/g, " ").trim();
    return text || fallback;
}

export function formatXiaohongshuShareForPrompt(input: {
    author?: string;
    title?: string;
    body?: string;
    description?: string;
}): string {
    const author = compactShareText(input.author, "未知作者");
    const title = compactShareText(input.title, "无标题");
    const body = compactShareText(input.body, "无正文内容");
    const description = compactShareText(input.description, "");
    return `分享了一条小红书帖子，作者：${author}, 标题：${title}, 正文内容：${body}，图片/视频描述：${description || "无"}`;
}
