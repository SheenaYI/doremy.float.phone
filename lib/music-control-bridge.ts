import type { MusicTrack } from "./music-storage";
import type { PlayMode } from "./music-context";

export type MusicControlSnapshot = {
    /**
     * 快照归属的身份。单用户部署下恒为 LOCAL_IDENTITY_ID。
     * 保留这个字段是因为「一起听」会用它判断快照是否属于当前身份 ——
     * 那份代码来自多用户身份空间的版本，用固定值即可满足同样的判断形状。
     */
    identityId?: string | null;
    currentTrack: MusicTrack | null;
    /**
     * 界面当前选中的曲目，即使音频源尚未加载也有值。
     * 「一起听」邀请卡片要在还没播放时就能显示歌名与封面，靠的就是它。
     */
    selectedTrack?: MusicTrack | null;
    isPlaying: boolean;
    currentTime: number;
    duration: number;
    playMode: PlayMode;
    queue: MusicTrack[];
    volume: number;
};

export type MusicControlBridge = {
    getState: () => MusicControlSnapshot;
    playTrack: (track: MusicTrack) => Promise<{ ok: boolean; message: string; track?: MusicTrack }>;
    playByQuery: (query: string, artist?: string) => Promise<{ ok: boolean; message: string; track?: MusicTrack }>;
    addToQueue: (tracks: MusicTrack[], options?: { replace?: boolean; playFirst?: boolean }) => Promise<{ ok: boolean; message: string; queue: MusicTrack[] }>;
    pause: () => void;
    resume: () => void;
    stop: () => void;
    next: () => void;
    prev: () => void;
    setPlayMode: (mode: PlayMode) => void;
};

let bridge: MusicControlBridge | null = null;

export function registerMusicControlBridge(nextBridge: MusicControlBridge | null): void {
    bridge = nextBridge;
}

export function getMusicControlBridge(): MusicControlBridge | null {
    return bridge;
}
