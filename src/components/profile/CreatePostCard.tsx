"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { chatApi, readAxiosErrorMessage } from "@/chat/api";
import { SafeRemoteImage } from "@/components/ui/SafeRemoteImage";

export type CreatePostCardProps = {
  token: string;
  onPosted?: () => void;
  className?: string;
  composerAvatarUrl?: string | null;
  composerName?: string | null;
};

/**
 * Mockup-style composer: white card, avatar + beige “Create Post” field, expands for text and actions.
 */
export default function CreatePostCard({
  token,
  onPosted,
  className = "",
  composerAvatarUrl,
  composerName,
}: CreatePostCardProps) {
  const id = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const [content, setContent] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initial =
    (composerName ?? "").trim().slice(0, 1).toUpperCase() ||
    (composerAvatarUrl ? "" : "?");

  useEffect(() => {
    if (!imageFile) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(imageFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  const clearImage = useCallback(() => {
    setImageFile(null);
    setPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const resetForm = useCallback(() => {
    setContent("");
    clearImage();
    setFocused(false);
    setError(null);
  }, [clearImage]);

  const handlePost = async () => {
    const text = content.trim();
    if (!text && !imageFile) {
      setError("Add some text or an image.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let mediaUrl: string | undefined;
      if (imageFile) {
        mediaUrl = await chatApi.uploadProfileImageWithFetch(token, imageFile);
      }
      await chatApi.createPost(token, {
        content: text || (imageFile ? " " : ""),
        mediaUrl,
      });
      resetForm();
      onPosted?.();
    } catch (e) {
      setError(readAxiosErrorMessage(e) ?? "Could not create post.");
    } finally {
      setBusy(false);
    }
  };

  const expanded = focused || content.trim().length > 0 || Boolean(imageFile);

  return (
    <div
      className={`overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm dark:border-slate-600 dark:bg-slate-900 ${className}`}
    >
      {error ? (
        <div className="border-b border-slate-100 bg-red-50 px-4 py-2.5 text-sm text-red-800 dark:border-slate-700 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </div>
      ) : null}

      <div className="p-4">
        <div className="flex gap-3">
          <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full border border-slate-200 bg-slate-100 dark:border-slate-600 dark:bg-slate-800">
            {composerAvatarUrl ? (
              <SafeRemoteImage
                src={composerAvatarUrl}
                alt=""
                className="h-full w-full object-cover"
                variant="avatar"
                loading="lazy"
                decoding="async"
              />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-sm font-semibold text-slate-600 dark:text-slate-300">
                {initial}
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <label htmlFor={`${id}-content`} className="sr-only">
              Create post
            </label>
            {!expanded ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => setFocused(true)}
                className="w-full rounded-xl border border-transparent bg-[#f4f1eb] px-4 py-2.5 text-left text-sm text-slate-500 transition hover:bg-[#ede9e1] dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700/80"
              >
                Create Post
              </button>
            ) : (
              <textarea
                id={`${id}-content`}
                rows={expanded ? 4 : 2}
                placeholder="Create Post"
                value={content}
                disabled={busy}
                onChange={(e) => setContent(e.target.value)}
                onFocus={() => setFocused(true)}
                onBlur={() => {
                  if (!content.trim() && !imageFile) setFocused(false);
                }}
                className="w-full resize-y rounded-xl border border-transparent bg-[#f4f1eb] px-4 py-3 text-[15px] leading-relaxed text-slate-900 shadow-inner outline-none transition placeholder:text-slate-400 focus:border-slate-200 focus:bg-white focus:ring-1 focus:ring-slate-200 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-slate-600 dark:focus:bg-slate-900 dark:focus:ring-slate-600"
                style={{ minHeight: 88 }}
              />
            )}
          </div>
        </div>

        {previewUrl ? (
          <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-600">
            <div className="relative">
              <img
                src={previewUrl}
                alt=""
                className="max-h-64 w-full object-cover"
                loading="eager"
                decoding="async"
              />
              <button
                type="button"
                disabled={busy}
                onClick={clearImage}
                className="absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-sm font-semibold text-white hover:bg-black/70 disabled:opacity-50"
                aria-label="Remove image"
              >
                ×
              </button>
            </div>
          </div>
        ) : null}

        {expanded ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 dark:border-slate-700">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800">
              <span aria-hidden>🖼</span>
              Add image
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="sr-only"
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  setImageFile(f ?? null);
                  e.target.value = "";
                }}
              />
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={resetForm}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Clear
              </button>
              <button
                type="button"
                disabled={busy || (!content.trim() && !imageFile)}
                onClick={() => void handlePost()}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:bg-blue-300 dark:disabled:bg-slate-600"
              >
                {busy ? "Posting…" : "Post"}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
