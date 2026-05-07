"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { chatApi, readAxiosErrorMessage } from "@/chat/api";

export type CreatePostCardProps = {
  token: string;
  /** Called after a successful `POST /api/posts` so the parent can refetch the feed. */
  onPosted?: () => void;
  className?: string;
};

/**
 * Social-style composer: expanding textarea, optional image preview (ringed like profile avatar),
 * and Post → `POST /api/posts` via shared API client (axios).
 */
export default function CreatePostCard({ token, onPosted, className = "" }: CreatePostCardProps) {
  const id = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [content, setContent] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    setExpanded(false);
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

  return (
    <div
      className={`overflow-hidden rounded-3xl border border-[var(--feed-border)] bg-[var(--feed-surface)] shadow-sm ${className}`}
    >
      {error ? (
        <div className="border-b border-[var(--feed-border)] bg-red-50 px-4 py-3 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </div>
      ) : null}

      <div className="border-b border-[var(--feed-border)] bg-gradient-to-b from-[color-mix(in_srgb,var(--feed-muted)_80%,transparent)] to-[var(--feed-surface)] px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--foreground)]">Create post</p>
            <p className="mt-0.5 text-xs text-[var(--feed-placeholder)]">Share an update with your network.</p>
          </div>
          <span className="rounded-full border border-[var(--feed-border)] bg-[var(--feed-surface)] px-2.5 py-1 text-[11px] font-semibold text-[var(--feed-placeholder)]">
            {busy ? "Working…" : "Draft"}
          </span>
        </div>
      </div>

      <div className="px-5 pb-5 pt-4">
          <label htmlFor={`${id}-content`} className="sr-only">
            Post content
          </label>
          <textarea
            id={`${id}-content`}
            rows={expanded ? 4 : 2}
            placeholder="What’s on your mind?"
            value={content}
            disabled={busy}
            onChange={(e) => setContent(e.target.value)}
            onFocus={() => setExpanded(true)}
          className="w-full resize-y rounded-2xl border border-[var(--feed-border)] bg-[var(--feed-muted)] px-4 py-3.5 text-[15px] leading-relaxed text-[var(--foreground)] shadow-inner outline-none transition-[min-height,border-color] placeholder:text-[var(--feed-placeholder)] focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 dark:focus:border-blue-400 dark:focus:ring-blue-400/25"
          style={{ minHeight: expanded ? 112 : 56 }}
          />

      {previewUrl ? (
        <div className="mt-4 overflow-hidden rounded-2xl border border-[var(--feed-border)] bg-[var(--feed-surface)]">
          <div className="relative">
            <img
              src={previewUrl}
              alt=""
              className="max-h-[320px] w-full object-cover"
              loading="eager"
              decoding="async"
            />
            <button
              type="button"
              disabled={busy}
              onClick={clearImage}
              className="absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-base font-semibold text-white shadow-md hover:bg-black/70 disabled:opacity-50"
              aria-label="Remove image"
              title="Remove"
            >
              ×
            </button>
          </div>
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <p className="min-w-0 truncate text-sm font-medium text-[var(--foreground)]">Image attached</p>
            <button
              type="button"
              disabled={busy}
              onClick={clearImage}
              className="rounded-lg border border-[var(--feed-border)] bg-[var(--feed-muted)] px-3 py-1.5 text-xs font-semibold text-[var(--foreground)] hover:bg-[var(--feed-surface)] disabled:opacity-50"
            >
              Remove
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--feed-border)] pt-4">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-[var(--feed-border)] bg-[var(--feed-muted)] px-4 py-2.5 text-sm font-semibold text-[var(--foreground)] hover:bg-[var(--feed-surface)] disabled:opacity-50">
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
            className="rounded-xl border border-[var(--feed-border)] bg-[var(--feed-surface)] px-4 py-2.5 text-sm font-semibold text-[var(--foreground)] hover:bg-[var(--feed-muted)] disabled:opacity-50"
          >
            Clear
          </button>
          <button
            type="button"
            disabled={busy || (!content.trim() && !imageFile)}
            onClick={() => void handlePost()}
            className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:bg-blue-300 dark:disabled:bg-slate-600"
          >
            {busy ? "Posting…" : "Post"}
          </button>
        </div>
      </div>
      </div>
    </div>
  );
}
