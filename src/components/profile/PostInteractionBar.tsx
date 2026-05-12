"use client";

import { useEffect, useRef, useState } from "react";
import { chatApi, readAxiosErrorMessage } from "@/chat/api";

/** Same set as chat quick reactions — pill picker (Messenger-style). */
const PICKER_EMOJIS = ["👍", "❤️", "😆", "😮", "😢", "😡"] as const;

const DEFAULT_LIKE_EMOJI = "👍";

/** Emoji shown on the main reaction control: yours first, else top count from `reactionSummary`, else 👍. */
function likeBarEmoji(
  myReaction: string | null | undefined,
  summary: Record<string, number> | null | undefined
): string {
  const mine = myReaction?.trim();
  if (mine) return mine;
  if (summary && Object.keys(summary).length > 0) {
    let best = DEFAULT_LIKE_EMOJI;
    let bestN = -1;
    for (const [em, n] of Object.entries(summary)) {
      if (typeof n === "number" && n > bestN) {
        bestN = n;
        best = em;
      }
    }
    return best;
  }
  return DEFAULT_LIKE_EMOJI;
}

export type PostInteractionBarProps = {
  token: string;
  postId: string;
  initialReactionCount?: number;
  /** Per-emoji counts from the post payload (e.g. `{ "❤️": 1 }`). */
  initialReactionSummary?: Record<string, number> | null;
  initialCommentCount?: number;
  initialMyReaction?: string | null;
  /** Scroll target id for the comment composer/list in the parent card. */
  commentSectionId?: string;
  className?: string;
};

/**
 * Horizontal React / Comment / Share bar.
 * Theming: `--post-bar-text` and `--post-bar-hover` (see `globals.css`).
 */
export default function PostInteractionBar({
  token,
  postId,
  initialReactionCount = 0,
  initialReactionSummary = null,
  initialCommentCount = 0,
  initialMyReaction = null,
  commentSectionId,
  className = "",
}: PostInteractionBarProps) {
  const [reactionCount, setReactionCount] = useState(initialReactionCount);
  const [reactionSummary, setReactionSummary] = useState<Record<string, number> | null>(
    initialReactionSummary && Object.keys(initialReactionSummary).length > 0
      ? initialReactionSummary
      : null
  );
  const [myReaction, setMyReaction] = useState<string | null>(initialMyReaction ?? null);
  const [commentCount, setCommentCount] = useState(initialCommentCount);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [busy, setBusy] = useState<"react" | "share" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pickerRef = useRef<HTMLDivElement>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressDidFireRef = useRef(false);
  const LONG_PRESS_MS = 450;

  const clearLongPressTimer = (): void => {
    if (longPressTimerRef.current != null) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  useEffect(() => {
    setReactionCount(initialReactionCount);
  }, [initialReactionCount, postId]);

  useEffect(() => {
    setReactionSummary(
      initialReactionSummary && Object.keys(initialReactionSummary).length > 0
        ? initialReactionSummary
        : null
    );
  }, [initialReactionSummary, postId]);

  useEffect(() => {
    setCommentCount(initialCommentCount);
  }, [initialCommentCount, postId]);

  useEffect(() => {
    setMyReaction(initialMyReaction ?? null);
  }, [initialMyReaction, postId]);

  const barEmoji = likeBarEmoji(myReaction, reactionSummary);
  const emojiToToggle = myReaction?.trim() ? myReaction.trim() : DEFAULT_LIKE_EMOJI;

  useEffect(() => {
    if (!pickerOpen) return;
    const onDoc = (e: MouseEvent): void => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [pickerOpen]);

  const handleEmojiPick = async (emoji: string) => {
    setBusy("react");
    setError(null);
    setPickerOpen(false);
    try {
      const result = await chatApi.reactToPost(token, postId, emoji);
      setReactionCount(result.reactionCount);
      setMyReaction(result.myReaction);
    } catch (e) {
      setError(readAxiosErrorMessage(e) ?? "Could not update reaction.");
    } finally {
      setBusy(null);
    }
  };

  const confirmShare = async () => {
    setBusy("share");
    setError(null);
    try {
      await chatApi.sharePostToFeed(token, postId);
      setShareOpen(false);
    } catch (e) {
      setError(readAxiosErrorMessage(e) ?? "Could not share post.");
    } finally {
      setBusy(null);
    }
  };

  const btn =
    "flex flex-1 items-center justify-center gap-1.5 py-2.5 text-sm font-medium transition-colors hover:bg-[var(--post-bar-hover)] disabled:opacity-50";

  return (
    <div className={`relative ${className}`}>
      {error ? (
        <p className="mb-2 text-center text-xs text-red-600 dark:text-red-400">{error}</p>
      ) : null}

      <div
        className="flex items-stretch divide-x divide-slate-200 border-t border-slate-200 pt-0 dark:divide-slate-600 dark:border-slate-600"
        style={{ color: "var(--post-bar-text)" }}
      >
        <div className="group/preact relative flex min-w-0 flex-1" ref={pickerRef}>
          <button
            type="button"
            disabled={busy !== null}
            title={`React (${barEmoji}) — hold for more choices`}
            className={btn}
            onPointerDown={() => {
              if (busy !== null) return;
              longPressDidFireRef.current = false;
              clearLongPressTimer();
              longPressTimerRef.current = setTimeout(() => {
                longPressTimerRef.current = null;
                longPressDidFireRef.current = true;
                setPickerOpen(true);
              }, LONG_PRESS_MS);
            }}
            onPointerUp={() => {
              clearLongPressTimer();
              if (longPressDidFireRef.current) {
                longPressDidFireRef.current = false;
                return;
              }
              if (pickerOpen) {
                setPickerOpen(false);
                return;
              }
              void handleEmojiPick(emojiToToggle);
            }}
            onPointerLeave={() => {
              clearLongPressTimer();
              longPressDidFireRef.current = false;
            }}
            onPointerCancel={() => {
              clearLongPressTimer();
              longPressDidFireRef.current = false;
            }}
            onKeyDown={(e) => {
              if (busy !== null) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                if (pickerOpen) setPickerOpen(false);
                else void handleEmojiPick("👍");
              }
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setPickerOpen(true);
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setPickerOpen(false);
              }
            }}
          >
            <span className="text-base leading-none" aria-hidden>
              {barEmoji}
            </span>
            <span>
              Like{reactionCount > 0 ? ` (${reactionCount})` : ""}
            </span>
          </button>
          <div
            className={`absolute bottom-full left-1/2 z-20 mb-1 flex -translate-x-1/2 items-center gap-0.5 rounded-full border border-slate-200/90 bg-white px-2 py-1.5 shadow-[0_4px_24px_rgba(15,23,42,0.14)] ring-1 ring-black/[0.04] transition-opacity duration-150 ${
              pickerOpen
                ? "pointer-events-auto opacity-100"
                : "pointer-events-none opacity-0 sm:pointer-events-none sm:opacity-0 sm:group-hover/preact:pointer-events-auto sm:group-hover/preact:opacity-100"
            }`}
            role="listbox"
            aria-label="Choose reaction"
          >
            {PICKER_EMOJIS.map((em) => (
              <button
                key={em}
                type="button"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-2xl leading-none transition-transform hover:bg-slate-100 active:scale-90"
                onClick={() => void handleEmojiPick(em)}
              >
                {em}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            setError(null);
            if (!commentSectionId) return;
            const el = document.getElementById(commentSectionId);
            if (!el) return;
            el.scrollIntoView({ behavior: "smooth", block: "nearest" });
          }}
          className={btn}
        >
          <span className="text-base leading-none opacity-90" aria-hidden>
            💬
          </span>
          <span>
            Comment{commentCount > 0 ? ` (${commentCount})` : ""}
          </span>
        </button>

        <button
          type="button"
          disabled={busy !== null}
          onClick={() => {
            setShareOpen(true);
            setError(null);
          }}
          className={btn}
        >
          <span className="text-base leading-none opacity-90" aria-hidden>
            ↗
          </span>
          <span>Share</span>
        </button>
      </div>

      {shareOpen ? (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setShareOpen(false);
          }}
        >
          <div
            className="w-full max-w-sm rounded-2xl border p-5 shadow-xl"
            style={{
              background: "var(--feed-surface)",
              borderColor: "var(--feed-border)",
              color: "var(--foreground)",
            }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="share-post-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h3 id="share-post-title" className="text-lg font-semibold">
              Share to your feed?
            </h3>
            <p className="mt-2 text-sm opacity-80">
              This will reshare the post on your own profile for your followers to see.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-xl px-4 py-2 text-sm font-medium hover:bg-[var(--post-bar-hover)]"
                style={{ color: "var(--post-bar-text)" }}
                onClick={() => setShareOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy === "share"}
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                onClick={() => void confirmShare()}
              >
                {busy === "share" ? "Sharing…" : "Share"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
