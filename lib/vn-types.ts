export type VnFrame = {
  bg?: string;       // scene name (e.g. "教室走廊")
  sprite?: string;   // sprite key (e.g. "沈既川/微笑")
  speaker?: string;  // null = narration
  text: string;
  sourceMessageId?: string;
  sourceFrameIndex?: number;
  sourceRole?: VnMessage["role"];
  sourceCreatedAt?: string;
  /** 这一帧所属 AI 回复的状态浮窗原文 */
  statusText?: string;
  voiceAudio?: VnFrameAudio;
};

export type VnOptions = { choices: string[] };

export type VnParsedResponse = {
  frames: VnFrame[];
  options: VnOptions | null;
  rawText: string;
  summaryText: string;
  statusText: string;
};

export type VnBeat = {
  id: string;
  title: string;
  description?: string;
};

export type VnChapterMeta = {
  id: string;
  index: number;
  title: string;
  subtitle?: string;
  startMessageId: string;
  endMessageId?: string;   // null = active chapter
  archived: boolean;
  summaryContent?: string;
  summaryTimestamp?: string;
  /** false = 章节总结只进入 VN 上下文，不写入记忆时间线；默认 true。 */
  summaryInMemory?: boolean;
  /** 所属合册；有值时星空图用合册代替该章 */
  volumeId?: string;
  /** 正文消息是否已被合册清理（只保留摘要） */
  messagesCleared?: boolean;
  beats?: VnBeat[];
  activeBeatIndex?: number;
};

export type VnLayoutPrefs = {
  dialogueY: number;
};

export type VnVolume = {
  id: string;
  title: string;
  chapterIds: string[];
  summary: string;
  createdAt: string;
  /** false = 只作为归档展示与上下文，不写入记忆 */
  summaryInMemory?: boolean;
  /** true = 创建时已清理这些章节的正文消息 */
  messagesCleared?: boolean;
};

export type VnSession = {
  id: string;
  characterId: string;
  updatedAt: string;
  chapters: VnChapterMeta[];
  volumes?: VnVolume[];
  activeChapterIndex: number;
  lastMessageId?: string;
  lastMessagePreview?: string;
  layoutPrefs?: VnLayoutPrefs;
};

export type VnMessage = {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  rawContent: string;
  chapterIndex: number;
  createdAt: string;
  frameAudio?: Record<number, VnFrameAudio>;
  roundSummary?: string;
  /** 本轮 [状态浮窗] 的原始文本，便于历史回看与增量合并 */
  statusRaw?: string;
};

export type VnFrameAudio = {
  audioDataUrl: string;
  synthesizedFromText: string;
  updatedAt: string;
};
