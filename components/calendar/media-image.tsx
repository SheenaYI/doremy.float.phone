"use client";

import { useEffect, useState } from "react";
import { loadMediaObjectUrl } from "@/lib/media-cache-storage";

export function CalendarMediaImage({
  mediaRef,
  alt,
  className,
  onClick,
}: {
  mediaRef: string;
  alt: string;
  className?: string;
  onClick?: () => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;
    setSrc(null);
    setFailed(false);
    void loadMediaObjectUrl(mediaRef).then(url => {
      if (!alive) {
        if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
        return;
      }
      objectUrl = url;
      setSrc(url);
      if (!url) setFailed(true);
    }).catch(() => {
      if (alive) setFailed(true);
    });
    return () => {
      alive = false;
      if (objectUrl?.startsWith("blob:")) URL.revokeObjectURL(objectUrl);
    };
  }, [mediaRef]);

  if (failed) {
    return <span className={`calendar-media-missing ${className ?? ""}`}>图片已失效</span>;
  }
  if (!src) {
    return <span className={`calendar-media-loading ${className ?? ""}`} aria-hidden="true" />;
  }
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onClick={onClick}
      loading="lazy"
      decoding="async"
    />
  );
}
