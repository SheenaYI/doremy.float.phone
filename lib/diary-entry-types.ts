export type DiaryEntryTrigger = "manual" | "timer";

export type DiaryEntryTodoItem = {
  text: string;
  done: boolean;
};

export type DiaryAttachment =
  | {
      id: string;
      type: "chat";
      sessionId: string;
      messageIds: string[];
      excerpt: string;
      role?: "user" | "assistant";
      createdAt: string;
    }
  | {
      id: string;
      type: "music";
      title: string;
      artist: string;
      coverUrl?: string;
      trackId?: string;
      note?: string;
      createdAt: string;
    }
  | {
      id: string;
      type: "photo";
      mediaRef: string;
      caption?: string;
      createdAt: string;
    }
  | {
      id: string;
      type: "experience";
      ownerType: "user" | "character";
      ownerId: string;
      date: string;
      experienceId: string;
      title: string;
      startTime?: string;
      note?: string;
      createdAt: string;
    };

export type DiaryEntryBlock =
  | { type: "paragraph"; text: string }
  | { type: "quote"; text: string }
  | { type: "highlight"; text: string }
  | { type: "bold"; text: string }
  | { type: "italic"; text: string }
  | { type: "list"; ordered: boolean; title?: string; items: string[] }
  | { type: "correction"; text: string; replacement?: string }
  | { type: "todo"; title?: string; items: DiaryEntryTodoItem[] }
  | { type: "image"; caption?: string; description: string };

export type DiaryEntry = {
  id: string;
  characterId: string;
  characterName: string;
  title: string;
  dateLabel: string;
  mood: string;
  weather: string;
  tags: string[];
  body: string;
  blocks: DiaryEntryBlock[];
  attachments: DiaryAttachment[];
  trigger: DiaryEntryTrigger;
  createdAt: string;
  updatedAt: string;
};

export type DiaryEntryInput = {
  characterId: string;
  characterName: string;
  title: string;
  dateLabel?: string;
  mood?: string;
  weather?: string;
  tags?: string[];
  body: string;
  blocks: DiaryEntryBlock[];
  attachments?: DiaryAttachment[];
  trigger?: DiaryEntryTrigger;
};

export type DiaryEntryTimerSettings = {
  enabled: boolean;
  intervalHours: number;
  characterIds: string[];
  lastRunAtByCharacter: Record<string, string>;
};

export const DEFAULT_DIARY_ENTRY_TIMER_SETTINGS: DiaryEntryTimerSettings = {
  enabled: false,
  intervalHours: 24,
  characterIds: [],
  lastRunAtByCharacter: {},
};
