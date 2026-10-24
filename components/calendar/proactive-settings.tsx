"use client";

import { useMemo, useState } from "react";
import { Toggle, Input, Textarea } from "../ui/form";
import type { CalendarOwnerType, CalendarScheduleItem } from "@/lib/calendar-types";
import { loadCalendarWeekPlan } from "@/lib/calendar-storage";
import {
  CALENDAR_PROACTIVE_TRIGGER_OPTIONS,
  deleteCalendarProactiveConfigForItem,
  loadCalendarProactiveConfigForItem,
  saveCalendarProactiveConfig,
  type CalendarProactiveTrigger,
} from "@/lib/calendar-proactive-storage";

export function CalendarProactiveSettings({
  ownerType,
  ownerId,
  weekStart,
  onNotice,
}: {
  ownerType: CalendarOwnerType;
  ownerId: string;
  weekStart: string;
  onNotice?: (message: string) => void;
}) {
  const [version, setVersion] = useState(0);
  const items = useMemo(() => {
    const plan = loadCalendarWeekPlan(ownerType, ownerId, weekStart);
    return [...(plan?.items ?? [])].sort((a, b) =>
      a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime)
    );
  }, [ownerType, ownerId, weekStart, version]);
  const configs = useMemo(() => {
    const map = new Map<string, ReturnType<typeof loadCalendarProactiveConfigForItem>>();
    for (const item of items) {
      map.set(item.id, loadCalendarProactiveConfigForItem(ownerType, ownerId, item.id));
    }
    return map;
  }, [items, ownerType, ownerId, version]);
  const [openId, setOpenId] = useState<string | null>(null);
  const refresh = () => setVersion(value => value + 1);

  const enable = (item: CalendarScheduleItem) => {
    const now = new Date();
    saveCalendarProactiveConfig({
      ownerType,
      ownerId,
      itemId: item.id,
      date: item.date,
      title: item.title,
      startTime: item.startTime,
      endTime: item.endTime,
      trigger: "end",
      offsetMinutes: 0,
      probability: 70,
      allowSkip: true,
      extraPrompt: "",
      reroll: true,
    });
    setOpenId(item.id);
    refresh();
    onNotice?.(`已为「${item.title}」开启主动联系`);
  };

  const disable = (item: CalendarScheduleItem) => {
    deleteCalendarProactiveConfigForItem(ownerType, ownerId, item.id);
    if (openId === item.id) setOpenId(null);
    refresh();
    onNotice?.(`已关闭「${item.title}」的主动联系`);
  };

  const update = (item: CalendarScheduleItem, patch: {
    trigger?: CalendarProactiveTrigger;
    offsetMinutes?: number;
    probability?: number;
    allowSkip?: boolean;
    extraPrompt?: string;
  }) => {
    const current = loadCalendarProactiveConfigForItem(ownerType, ownerId, item.id);
    if (!current) return;
    saveCalendarProactiveConfig({
      ownerType,
      ownerId,
      itemId: item.id,
      date: item.date,
      title: item.title,
      startTime: item.startTime,
      endTime: item.endTime,
      trigger: patch.trigger ?? current.trigger,
      offsetMinutes: patch.offsetMinutes ?? current.offsetMinutes,
      probability: patch.probability ?? current.probability,
      allowSkip: patch.allowSkip ?? current.allowSkip,
      extraPrompt: patch.extraPrompt ?? current.extraPrompt,
      reroll: false,
    });
    refresh();
  };

  if (ownerType !== "character") {
    return (
      <section className="calendar-generate-card calendar-proactive-settings">
        <div className="calendar-generate-card-head">
          <div>
            <strong>行程主动联系</strong>
            <em>只有角色行程可以主动联系；用户日程仅作记录。</em>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="calendar-generate-card calendar-proactive-settings">
      <div className="calendar-generate-card-head">
        <div>
          <strong>行程主动联系</strong>
          <em>到点后角色可以主动发一条消息；概率只是倾向，不保证触发。</em>
        </div>
      </div>
      {items.length === 0 ? (
        <p className="calendar-proactive-empty">本周还没有角色行程，先生成或手动添加一条。</p>
      ) : (
        <div className="calendar-proactive-list">
          {items.map(item => {
            const config = configs.get(item.id) ?? null;
            const open = openId === item.id;
            return (
              <article key={item.id} className="calendar-proactive-item" data-open={open ? "true" : undefined}>
                <div className="calendar-proactive-item-head">
                  <button type="button" className="calendar-proactive-item-title" onClick={() => setOpenId(open ? null : item.id)}>
                    <span>{item.date} · {weekday(item.date)} · {item.startTime}</span>
                    <strong>{item.emoji ? `${item.emoji} ` : ""}{item.title}</strong>
                  </button>
                  <Toggle
                    checked={Boolean(config)}
                    onChange={checked => checked ? enable(item) : disable(item)}
                  />
                </div>
                {config && open ? (
                  <div className="calendar-proactive-config">
                    <div className="calendar-proactive-triggers hide-scrollbar">
                      {CALENDAR_PROACTIVE_TRIGGER_OPTIONS.map(option => (
                        <button
                          key={option.id}
                          type="button"
                          className="calendar-proactive-trigger"
                          data-active={config.trigger === option.id ? "true" : undefined}
                          onClick={() => update(item, {
                            trigger: option.id,
                            offsetMinutes: option.needsOffset ? option.defaultOffset : 0,
                          })}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                    {CALENDAR_PROACTIVE_TRIGGER_OPTIONS.find(option => option.id === config.trigger)?.needsOffset ? (
                      <label className="calendar-proactive-field">
                        <span>相对分钟</span>
                        <Input
                          type="number"
                          min={0}
                          max={1440}
                          defaultValue={config.offsetMinutes}
                          onBlur={event => update(item, { offsetMinutes: Number(event.target.value) || 0 })}
                        />
                      </label>
                    ) : null}
                    <label className="calendar-proactive-field">
                      <span>触发概率</span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={5}
                        value={config.probability}
                        onChange={event => update(item, { probability: Number(event.target.value) })}
                      />
                      <em>{config.probability}%</em>
                    </label>
                    <label className="calendar-proactive-check">
                      <input
                        type="checkbox"
                        checked={config.allowSkip}
                        onChange={event => update(item, { allowSkip: event.target.checked })}
                      />
                      <span>允许 TA 跳过（TA 可以选择不发）</span>
                    </label>
                    <Textarea
                      defaultValue={config.extraPrompt}
                      placeholder="额外提示：例如会议结束后，可以分享一些感受。"
                      rows={2}
                      onBlur={event => update(item, { extraPrompt: event.target.value })}
                    />
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function weekday(iso: string): string {
  return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][new Date(`${iso}T00:00:00`).getDay()];
}
