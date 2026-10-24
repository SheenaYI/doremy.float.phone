"use client";

import { DiaryEntriesApp } from "./diary-entries-app";

type DiaryAppProps = {
  onClose: () => void;
  onNotice?: (message: string) => void;
};

/**
 * 手记入口：不再保留中间那张「日记」功能卡，直接从桌面进入角色档案。
 * 便签墙入口仍保留在源码里，但当前产品形态下不暴露。
 */
export function DiaryApp({ onClose, onNotice }: DiaryAppProps) {
  return <DiaryEntriesApp onBack={onClose} onNotice={onNotice} />;
}
