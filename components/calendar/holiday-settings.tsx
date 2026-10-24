"use client";

import { useState } from "react";
import { Toggle } from "../ui/form";
import {
  CALENDAR_HOLIDAY_COUNTRIES,
  loadCalendarHolidayConfig,
  saveCalendarHolidayConfig,
  type CalendarHolidayConfig,
} from "@/lib/calendar-holiday-storage";

export function CalendarHolidaySettings({
  onNotice,
}: {
  onNotice?: (message: string) => void;
}) {
  const [config, setConfig] = useState<CalendarHolidayConfig>(() => loadCalendarHolidayConfig());

  const save = (next: CalendarHolidayConfig) => {
    setConfig(next);
    saveCalendarHolidayConfig(next);
    onNotice?.("节假日设置已保存");
  };

  const toggleCountry = (code: string) => {
    const selected = new Set(config.countries);
    if (selected.has(code)) selected.delete(code);
    else selected.add(code);
    save({ ...config, countries: Array.from(selected) });
  };

  return (
    <section className="calendar-generate-card calendar-holiday-settings">
      <div className="calendar-generate-card-head">
        <div>
          <strong>节假日标记</strong>
          <em>按国家/地区拉取公共节假日，缓存 30 天；断网时只显示已有缓存。</em>
        </div>
        <Toggle
          checked={config.enabled}
          onChange={enabled => save({ ...config, enabled })}
        />
      </div>
      <div className="calendar-holiday-countries">
        {CALENDAR_HOLIDAY_COUNTRIES.map(country => {
          const selected = config.countries.includes(country.code);
          return (
            <button
              key={country.code}
              type="button"
              className="calendar-holiday-country"
              data-active={selected ? "true" : undefined}
              onClick={() => toggleCountry(country.code)}
            >
              {country.label}
            </button>
          );
        })}
      </div>
      {config.enabled ? (
        <button
          type="button"
          className="calendar-holiday-refresh"
          onClick={() => window.dispatchEvent(new CustomEvent("calendar-holiday-refresh"))}
        >
          刷新节假日数据
        </button>
      ) : null}
      {config.enabled ? (
        <p className="calendar-holiday-hint">
          放假日期会加深底色，农历位改显示节日名；点开日期后可在回顾页看到完整名称。最多同时选择 10 个地区。
        </p>
      ) : null}
    </section>
  );
}
