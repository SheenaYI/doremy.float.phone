"use client";

import { useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ImagePlus, Plus, Sparkles, Trash2 } from "lucide-react";
import { Input, Textarea } from "../ui/form";
import type {
  CalendarExperience,
  CalendarExperienceImage,
  CalendarTagConfig,
  CalendarTagKind,
} from "@/lib/calendar-day-types";
import type { CalendarOwnerType } from "@/lib/calendar-types";
import { generateImageFromConfiguredApi } from "@/lib/image-generation-service";
import { storeMediaBlob } from "@/lib/media-cache-storage";
import { CalendarMediaImage } from "./media-image";
import { addCustomCalendarTag, loadCalendarTagConfig } from "@/lib/calendar-day-storage";

export function CalendarExperienceEditModal({
  draft,
  tagConfig,
  onChange,
  onSave,
  onDelete,
  onClose,
  ownerType = "character",
  characterId,
}: {
  draft: CalendarExperience;
  tagConfig: CalendarTagConfig;
  onChange: (next: CalendarExperience) => void;
  onSave: () => void;
  onDelete: () => void;
  onClose: () => void;
  ownerType?: CalendarOwnerType;
  characterId?: string;
}) {
  const [customKind, setCustomKind] = useState<CalendarTagKind | null>(null);
  const [customLabel, setCustomLabel] = useState("");
  const [config, setConfig] = useState<CalendarTagConfig>(tagConfig);
  const eventTypes = config.eventTypes;
  const moods = config.moods;
  const selectedEvent = useMemo(
    () => eventTypes.find(item => item.id === draft.eventTypeId) ?? eventTypes[0],
    [eventTypes, draft.eventTypeId],
  );
  const selectedMood = useMemo(
    () => moods.find(item => item.id === draft.moodTypeId) ?? moods[0],
    [moods, draft.moodTypeId],
  );
  const imageFileRef = useRef<HTMLInputElement | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const [imagePrompt, setImagePrompt] = useState("");
  const [captionImageId, setCaptionImageId] = useState<string | null>(null);
  const [imageError, setImageError] = useState("");

  const addImage = (image: CalendarExperienceImage) => {
    onChange({ ...draft, images: [...draft.images, image].slice(0, 4) });
  };

  const removeImage = (imageId: string) => {
    onChange({ ...draft, images: draft.images.filter(image => image.id !== imageId) });
    if (captionImageId === imageId) setCaptionImageId(null);
  };

  const updateImageCaption = (imageId: string, caption: string) => {
    onChange({
      ...draft,
      images: draft.images.map(image => image.id === imageId ? { ...image, caption: caption.trim() || undefined } : image),
    });
  };

  const handleUploadImage = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setImageError("请选择图片文件");
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      setImageError("图片不能超过 12MB");
      return;
    }
    setImageBusy(true);
    setImageError("");
    try {
      const mediaRef = await storeMediaBlob(file, file.type || "image/jpeg", "image");
      addImage({
        id: `calendar_image_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        mediaRef,
        source: "upload",
        createdAt: new Date().toISOString(),
      });
    } catch {
      setImageError("图片保存失败");
    } finally {
      setImageBusy(false);
    }
  };

  const handleGenerateImage = async () => {
    if (imageBusy) return;
    setImageBusy(true);
    setImageError("");
    try {
      const description = [
        draft.title ? `场景：${draft.title}` : "",
        draft.note ? `经历：${draft.note}` : "",
        imagePrompt.trim() ? `补充画面：${imagePrompt.trim()}` : "",
      ].filter(Boolean).join("\n");
      const result = await generateImageFromConfiguredApi({
        description: description || "一张与日常经历有关的照片",
        characterId: ownerType === "character" ? characterId : undefined,
        appId: "calendar",
        useReferenceImage: ownerType === "character",
      });
      if (!result) {
        setImageError("生图未配置或已关闭");
        return;
      }
      addImage({
        id: `calendar_image_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        mediaRef: result.mediaRef,
        source: "generated",
        createdAt: new Date().toISOString(),
      });
    } catch (error) {
      setImageError(error instanceof Error ? error.message : "生成图片失败");
    } finally {
      setImageBusy(false);
    }
  };

  const submitCustomTag = () => {
    if (!customKind) return;
    const tag = addCustomCalendarTag(customKind, customLabel);
    if (tag) {
      setConfig(loadCalendarTagConfig());
      onChange({
        ...draft,
        ...(customKind === "event" ? { eventTypeId: tag.id } : { moodTypeId: tag.id }),
      });
    }
    setCustomKind(null);
    setCustomLabel("");
  };

  return (
    <div className="modal-overlay calendar-edit-modal-overlay" onClick={onClose}>
      <div
        className="calendar-edit-modal calendar-experience-modal"
        data-ui="calendar-experience-modal"
        onClick={event => event.stopPropagation()}
      >
        <div className="modal-header" data-ui="modal-header">
          <button onClick={onClose} className="modal-header-btn modal-header-btn-muted" aria-label="返回">
            <ChevronLeft size={18} />
          </button>
          <span className="modal-header-title">{draft.title ? "编辑经历" : "新增经历"}</span>
          <button onClick={onSave} className="modal-header-btn modal-header-btn-action" aria-label="保存">
            <Check size={18} />
          </button>
        </div>

        <div className="modal-body hide-scrollbar flex flex-col gap-3 pb-10" data-ui="modal-body">
          {draft.linkedScheduleId ? (
            <div className="calendar-experience-linked">
              <span>关联既定行程</span>
              <em>这条经历会显示在对应行程节点下</em>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="menu-desc ml-1">开始时间</label>
              <Input
                type="time"
                value={draft.startTime}
                onChange={event => onChange({ ...draft, startTime: event.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="menu-desc ml-1">结束时间（可不填）</label>
              <Input
                type="time"
                value={draft.endTime ?? ""}
                onChange={event => onChange({ ...draft, endTime: event.target.value || undefined })}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="menu-desc ml-1">经历标题</label>
            <Input
              value={draft.title}
              onChange={event => onChange({ ...draft, title: event.target.value })}
              placeholder="例如：路过咖啡店，碰到了旧友"
            />
          </div>

          <div className="flex flex-col gap-2">
            <div className="calendar-experience-tag-head">
              <label className="menu-desc">事件类型</label>
              <button
                type="button"
                className="calendar-experience-tag-add"
                onClick={() => {
                  setCustomKind(customKind === "event" ? null : "event");
                  setCustomLabel("");
                }}
              >
                <Plus size={12} /> 自定义
              </button>
            </div>
            <div className="calendar-tag-row hide-scrollbar">
              {eventTypes.map(tag => (
                <button
                  key={tag.id}
                  type="button"
                  className="calendar-tag-chip"
                  data-color={tag.color ?? "slate"}
                  data-active={draft.eventTypeId === tag.id ? "true" : undefined}
                  onClick={() => onChange({ ...draft, eventTypeId: tag.id })}
                >
                  {tag.label}
                </button>
              ))}
            </div>
            {customKind === "event" ? (
              <div className="calendar-custom-tag-row">
                <Input
                  autoFocus
                  value={customLabel}
                  onChange={event => setCustomLabel(event.target.value)}
                  placeholder="输入自定义事件类型"
                  onKeyDown={event => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      submitCustomTag();
                    }
                  }}
                />
                <button type="button" className="calendar-block-btn" data-variant="primary" onClick={submitCustomTag}>
                  添加
                </button>
              </div>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <div className="calendar-experience-tag-head">
              <label className="menu-desc">心情类型</label>
              <button
                type="button"
                className="calendar-experience-tag-add"
                onClick={() => {
                  setCustomKind(customKind === "mood" ? null : "mood");
                  setCustomLabel("");
                }}
              >
                <Plus size={12} /> 自定义
              </button>
            </div>
            <div className="calendar-tag-row hide-scrollbar">
              {moods.map(tag => (
                <button
                  key={tag.id}
                  type="button"
                  className="calendar-tag-chip"
                  data-color={tag.color ?? "slate"}
                  data-active={draft.moodTypeId === tag.id ? "true" : undefined}
                  onClick={() => onChange({ ...draft, moodTypeId: tag.id })}
                >
                  {tag.label}
                </button>
              ))}
            </div>
            {customKind === "mood" ? (
              <div className="calendar-custom-tag-row">
                <Input
                  autoFocus
                  value={customLabel}
                  onChange={event => setCustomLabel(event.target.value)}
                  placeholder="输入自定义心情类型"
                  onKeyDown={event => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      submitCustomTag();
                    }
                  }}
                />
                <button type="button" className="calendar-block-btn" data-variant="primary" onClick={submitCustomTag}>
                  添加
                </button>
              </div>
            ) : null}
          </div>

          <div className="flex flex-col gap-1">
            <label className="menu-desc ml-1">发生了什么</label>
            <Textarea
              value={draft.note}
              onChange={event => onChange({ ...draft, note: event.target.value })}
              placeholder="写一点这条经历里实际发生的事、当时的感受。"
              rows={5}
            />
          </div>

          <div className="calendar-experience-images">
            <div className="calendar-experience-tag-head">
              <label className="menu-desc">照片</label>
              <span className="calendar-experience-image-count">{draft.images.length} / 4</span>
            </div>
            {draft.images.length > 0 ? (
              <div className="calendar-experience-image-grid">
                {draft.images.map(image => (
                  <div key={image.id} className="calendar-experience-image-item" data-active={captionImageId === image.id ? "true" : undefined}>
                    <CalendarMediaImage
                      mediaRef={image.mediaRef}
                      alt={image.caption || draft.title}
                      onClick={() => setCaptionImageId(image.id)}
                    />
                    <button type="button" onClick={() => removeImage(image.id)} aria-label="删除图片">
                      <Trash2 size={12} />
                    </button>
                    <span>{image.source === "generated" ? "AI" : "上传"}</span>
                  </div>
                ))}
              </div>
            ) : null}
            <input
              ref={imageFileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleUploadImage}
            />
            <Input
              value={imagePrompt}
              onChange={event => setImagePrompt(event.target.value)}
              placeholder="生图补充：例如阴天、街角咖啡店、暖色胶片感"
            />
            {captionImageId ? (
              <Input
                value={draft.images.find(image => image.id === captionImageId)?.caption ?? ""}
                onChange={event => updateImageCaption(captionImageId, event.target.value)}
                placeholder="给这张图写个备注"
              />
            ) : null}
            <div className="calendar-experience-image-actions">
              <button
                type="button"
                className="calendar-block-btn"
                disabled={imageBusy || draft.images.length >= 4}
                onClick={() => imageFileRef.current?.click()}
              >
                <ImagePlus size={15} /> 上传
              </button>
              <button
                type="button"
                className="calendar-block-btn"
                data-variant="primary"
                disabled={imageBusy || draft.images.length >= 4}
                onClick={handleGenerateImage}
              >
                <Sparkles size={15} /> {imageBusy ? "处理中…" : "AI 生图"}
              </button>
            </div>
            {imageError ? <p className="calendar-experience-image-error">{imageError}</p> : null}
          </div>

          <div className="calendar-experience-selected">
            <span>已选</span>
            <b>{selectedEvent?.label ?? "日常"}</b>
            <i>·</i>
            <b>{selectedMood?.label ?? "平静"}</b>
          </div>

          {draft.linkedScheduleId ? (
            <p className="calendar-experience-delete-hint">删除后只移除这条实际经历，不会删除原行程。</p>
          ) : null}
          <button type="button" className="ui-btn ui-btn-outline calendar-delete-btn" onClick={onDelete}>
            <Trash2 size={16} />
            删除这条经历
          </button>
        </div>
      </div>
    </div>
  );
}
