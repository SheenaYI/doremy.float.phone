"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, EyeOff, Merge, Pencil, X } from "lucide-react";
import type { MemoryEntry } from "@/lib/memory-types";
import {
  loadMemoryTagRegistry,
  mergeMemoryTags,
  renameMemoryTag,
  seedMemoryTagRegistryFromEntries,
  setMemoryTagCore,
  setMemoryTagHidden,
  type MemoryTagRecord,
} from "@/lib/memory-tag-registry";

export function MemoryTagManager({
  characterId,
  entries,
  onClose,
  onChanged,
}: {
  characterId: string;
  entries: MemoryEntry[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [tags, setTags] = useState<MemoryTagRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(() => {
    setTags(loadMemoryTagRegistry(characterId));
  }, [characterId]);

  useEffect(() => {
    let cancelled = false;
    void seedMemoryTagRegistryFromEntries(characterId)
      .then(() => { if (!cancelled) refresh(); })
      .catch(() => { if (!cancelled) refresh(); });
    return () => { cancelled = true; };
  }, [characterId, refresh]);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of entries) {
      for (const tag of entry.tags ?? []) {
        map.set(tag, (map.get(tag) ?? 0) + 1);
      }
    }
    return map;
  }, [entries]);

  const ordered = useMemo(
    () => [...tags].sort((a, b) => {
      if (a.hidden !== b.hidden) return a.hidden ? 1 : -1;
      return (counts.get(b.label) ?? b.usage) - (counts.get(a.label) ?? a.usage);
    }),
    [tags, counts],
  );

  const run = async (task: () => void | Promise<number | void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await task();
      refresh();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "标签操作失败");
    } finally {
      setBusy(false);
    }
  };

  const handleMerge = (source: string, target: string) => {
    if (!target || source === target) return;
    void run(async () => {
      await mergeMemoryTags(characterId, source, target);
    });
  };

  const handleRename = (source: string) => {
    const next = window.prompt("新的标签名", source);
    if (!next || next.trim() === source) return;
    void run(async () => {
      await renameMemoryTag(characterId, source, next);
    });
  };

  return (
    <div className="mem-tag-manager-backdrop" onClick={onClose}>
      <section className="mem-tag-manager" onClick={event => event.stopPropagation()}>
        <header>
          <div>
            <span>MEMORY TAGS</span>
            <h2>标签管理</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭标签管理"><X size={18} /></button>
        </header>
        <p className="mem-tag-manager-note">
          只改标签，不改记忆正文。合并会把旧标签写入新标签的别名，并同步改写已有档案；隐藏只影响展示。
        </p>
        {error ? <p className="mem-tag-manager-error">{error}</p> : null}
        <div className="mem-tag-manager-list">
          {ordered.length === 0 ? (
            <p className="mem-tag-manager-empty">还没有标签。生成记忆或手动编辑标签后会出现在这里。</p>
          ) : ordered.map(tag => {
            const count = counts.get(tag.label) ?? tag.usage;
            const targets = ordered.filter(item => item.label !== tag.label && !item.hidden);
            return (
              <article key={tag.id} data-hidden={tag.hidden ? "true" : undefined}>
                <div className="mem-tag-manager-main">
                  <b>#{tag.label}</b>
                  <span>{count} 条 · {tag.kind === "core" ? "核心" : "自动"}{tag.hidden ? " · 已隐藏" : ""}</span>
                </div>
                <div className="mem-tag-manager-actions">
                  {targets.length > 0 ? (
                    <label className="mem-tag-manager-merge" title="合并到其他标签">
                      <Merge size={12} />
                      <select
                        value=""
                        disabled={busy}
                        onChange={event => {
                          const target = event.target.value;
                          event.target.value = "";
                          handleMerge(tag.label, target);
                        }}
                      >
                        <option value="">合并到…</option>
                        {targets.map(item => <option key={item.id} value={item.label}>#{item.label}</option>)}
                      </select>
                    </label>
                  ) : null}
                  <button type="button" title="重命名" disabled={busy} onClick={() => handleRename(tag.label)}>
                    <Pencil size={12} />
                  </button>
                  <button
                    type="button"
                    title={tag.hidden ? "恢复显示" : "隐藏标签"}
                    disabled={busy}
                    onClick={() => run(() => { setMemoryTagHidden(characterId, tag.label, !tag.hidden); })}
                  >
                    {tag.hidden ? <Eye size={12} /> : <EyeOff size={12} />}
                  </button>
                  <button
                    type="button"
                    title={tag.kind === "core" ? "改为自动标签" : "设为核心标签"}
                    disabled={busy}
                    onClick={() => run(() => { setMemoryTagCore(characterId, tag.label, tag.kind !== "core"); })}
                  >
                    {tag.kind === "core" ? "C" : "设"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
