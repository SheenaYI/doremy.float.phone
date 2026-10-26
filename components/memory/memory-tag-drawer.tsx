"use client";

import { X } from "lucide-react";

export function MemoryTagDrawer({
  tags,
  activeTag,
  onPick,
  onClose,
}: {
  tags: Array<[string, number]>;
  activeTag: string | null;
  onPick: (tag: string | null) => void;
  onClose: () => void;
}) {
  return (
    <div className="mem-tag-drawer-backdrop" onClick={onClose}>
      <section className="mem-tag-drawer" onClick={event => event.stopPropagation()}>
        <header>
          <div>
            <span>TAG DRAWER</span>
            <b>全部标签 · {tags.length}</b>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭标签抽屉"><X size={17} /></button>
        </header>
        <div className="mem-tag-drawer-list">
          <button
            type="button"
            className={activeTag === null ? "is-active" : undefined}
            onClick={() => onPick(null)}
          >
            全部
          </button>
          {tags.map(([tag, count]) => (
            <button
              key={tag}
              type="button"
              className={activeTag === tag ? "is-active" : undefined}
              onClick={() => onPick(tag)}
            >
              #{tag}
              <span>{count}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
