"use client";

import { useEffect, useState } from "react";
import { SafeRemoteImage } from "@/components/ui/SafeRemoteImage";

export type TopAlertProps = {
  open: boolean;
  senderName: string;
  preview: string;
  avatarUrl?: string | null;
  onClose: () => void;
  onClick: () => void;
  durationMs?: number;
};

/**
 * Global toast-like chat alert fixed to top-center.
 * Slides in from top and auto-dismisses after `durationMs`.
 */
export default function TopAlert({
  open,
  senderName,
  preview,
  avatarUrl,
  onClose,
  onClick,
  durationMs = 5000,
}: TopAlertProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!open) {
      setVisible(false);
      return;
    }
    const inTimer = window.setTimeout(() => setVisible(true), 20);
    const outTimer = window.setTimeout(() => {
      setVisible(false);
      window.setTimeout(onClose, 220);
    }, durationMs);
    return () => {
      window.clearTimeout(inTimer);
      window.clearTimeout(outTimer);
    };
  }, [open, onClose, durationMs]);

  if (!open) return null;

  const initial = senderName.trim().slice(0, 1).toUpperCase() || "?";

  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[120] flex justify-center px-3">
      <button
        type="button"
        onClick={onClick}
        className={`pointer-events-auto w-full max-w-md rounded-2xl border bg-white/80 p-3 text-left shadow-lg backdrop-blur-md transition-all duration-200 dark:bg-slate-900/75 ${
          visible ? "translate-y-0 opacity-100" : "-translate-y-8 opacity-0"
        } border-slate-200/80 hover:shadow-xl dark:border-slate-700/80`}
      >
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 shrink-0 overflow-hidden rounded-full border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-800">
            {avatarUrl ? (
              <SafeRemoteImage
                src={avatarUrl}
                alt=""
                className="h-full w-full object-cover"
                variant="avatar"
                loading="eager"
                decoding="async"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-sm font-bold text-slate-700 dark:text-slate-200">
                {initial}
              </div>
            )}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-slate-900 dark:text-slate-100">{senderName}</p>
            <p className="truncate text-sm text-slate-600 dark:text-slate-300">{preview}</p>
          </div>
        </div>
      </button>
    </div>
  );
}
