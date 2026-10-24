"use client";

import { CalendarDays, History, Wand2 } from "lucide-react";

export type CalendarViewTab = "schedule" | "review" | "generate";

const TABS: Array<{ id: CalendarViewTab; label: string; icon: typeof CalendarDays }> = [
  { id: "schedule", label: "行程", icon: CalendarDays },
  { id: "review", label: "回顾", icon: History },
  { id: "generate", label: "设置", icon: Wand2 },
];

export function CalendarViewTabs({
  active,
  onChange,
}: {
  active: CalendarViewTab;
  onChange: (tab: CalendarViewTab) => void;
}) {
  return (
    <div className="calendar-view-tabs" role="tablist" aria-label="日历视图">
      {TABS.map(tab => {
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active === tab.id}
            className="calendar-view-tab"
            data-active={active === tab.id ? "true" : undefined}
            onClick={() => onChange(tab.id)}
          >
            <Icon size={14} strokeWidth={1.8} />
            <span>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}
