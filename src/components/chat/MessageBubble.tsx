"use client";

import { useEffect, useState } from "react";
import { CHAT_BACKEND_ORIGIN } from "../../chat/api";
import { isChatDebug } from "../../chat/chatDebug";
import { getReplyTargetPreviewText } from "../../chat/replyPreview";
import { messageElementDomId, scrollToMessage } from "../../chat/scrollToMessage";
import type { ChatMessage } from "../../chat/types";
import VoiceMessagePlayer from "./VoiceMessagePlayer";

function toPlayableAudioUrl(raw: string): string {
  const u = raw.trim();
  /** Same-origin object URLs from the recorder / optimistic UI — never prefix the backend. */
  if (u.startsWith("blob:")) return u;
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith("//")) return `http:${u}`;
  if (u.startsWith("/")) return `${CHAT_BACKEND_ORIGIN}${u}`;
  return `${CHAT_BACKEND_ORIGIN}/${u}`;
}

type MessageBubbleProps = {
  message: ChatMessage;
  isMine: boolean;
  displaySender: string;
  currentUserId?: string | null;
  currentUsername?: string | null;
  onDelete: (messageId: string) => Promise<void>;
  onReact: (messageId: string, emoji: string) => Promise<void>;
  onReply: (message: ChatMessage) => void;
  onRequestEdit: (message: ChatMessage) => void;
};

const formatShortTime = (iso: string): string =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const QUICK_REACTIONS = ["👍", "❤️", "😆", "😮", "😢", "😡"] as const;

/** Prefer server `reactionSummary` when present; only show emojis with count > 0. */
function reactionDisplayEntries(message: ChatMessage): Array<[string, number]> {
  const base =
    message.reactionSummary !== undefined ? message.reactionSummary : (message.reactions ?? {});
  return (Object.entries(base) as Array<[string, number]>).filter(
    ([, count]) => typeof count === "number" && count > 0
  );
}

/** Hide voice metadata JSON if the server still stores it in `content`. */
function isVoiceJsonContent(text: string): boolean {
  const t = text.trim();
  if (!t.startsWith("{")) return false;
  try {
    const j = JSON.parse(t) as Record<string, unknown>;
    const typ = String(j.type ?? j.messageType ?? j.message_type ?? "").toLowerCase();
    if (typ !== "voice") return false;
    const keys = [j.audioUrl, j.audio_url, j.url, j.mediaUrl, j.fileUrl, j.attachmentUrl, j.path];
    return keys.some((k) => typeof k === "string" && k.trim().length > 0);
  } catch {
    return false;
  }
}

/** Fallback when `mediaUrl` was not mapped but `content` still holds voice JSON. */
function extractVoiceUrlFromContent(text: string): string | undefined {
  const t = text.trim();
  if (!t.startsWith("{")) return undefined;
  try {
    const j = JSON.parse(t) as Record<string, unknown>;
    const typ = String(j.type ?? j.messageType ?? j.message_type ?? "").toLowerCase();
    if (typ !== "voice") return undefined;
    const keys = [
      j.audioUrl,
      j.audio_url,
      j.url,
      j.mediaUrl,
      j.media_url,
      j.fileUrl,
      j.attachmentUrl,
      j.path,
      j.location,
      j.filePath,
    ];
    for (const k of keys) {
      if (typeof k === "string" && k.trim().length > 0) return k.trim();
    }
  } catch {
    return undefined;
  }
  return undefined;
}

type ReceiptPhase = "uploading" | "sending" | "sent" | "delivered" | "seen";

function seenBySomeoneElse(
  message: ChatMessage,
  currentUserId: string | null | undefined,
  currentUsername: string | null | undefined
): boolean {
  /** Blue "seen" only when at least one recipient id/username is present and is not the sender. */
  const combined = [...(message.seenBy ?? []), ...(message.readBy ?? [])];
  if (combined.length === 0) return false;
  const isMe = (t: string): boolean => {
    const s = String(t).trim();
    if (!s) return false;
    if (currentUserId != null && String(currentUserId) === s) return true;
    if (
      currentUsername != null &&
      currentUsername.trim().toLowerCase() === s.toLowerCase()
    )
      return true;
    return false;
  };
  return combined.some((t) => !isMe(String(t)));
}

function getReceiptPhase(
  message: ChatMessage,
  isMine: boolean,
  currentUserId: string | null | undefined,
  currentUsername: string | null | undefined
): ReceiptPhase | null {
  if (!isMine) return null;
  if (message.pending && message.voiceDeliveryPhase === "uploading") return "uploading";
  if (message.pending && message.voiceDeliveryPhase === "sending") return "sending";
  if (message.pending) return "sent";
  if (seenBySomeoneElse(message, currentUserId, currentUsername)) return "seen";
  return "delivered";
}

function ReceiptTicks({
  phase,
  isMineBubble,
}: {
  phase: Exclude<ReceiptPhase, "uploading" | "sending">;
  isMineBubble: boolean;
}) {
  const muted = isMineBubble ? "text-blue-100/80" : "text-slate-400";
  const seenBlue = "text-sky-300";

  if (phase === "sent") {
    return (
      <span
        className={`select-none transition-colors duration-200 ${muted}`}
        title="Sent"
        aria-label="Sent"
      >
        ✓
      </span>
    );
  }

  if (phase === "delivered") {
    return (
      <span
        className={`select-none transition-colors duration-200 ${muted}`}
        title="Delivered"
        aria-label="Delivered"
      >
        ✓✓
      </span>
    );
  }

  return (
    <span
      className={`select-none transition-colors duration-200 ${seenBlue}`}
      title="Seen"
      aria-label="Seen"
    >
      ✓✓
    </span>
  );
}

export default function MessageBubble({
  message,
  isMine,
  displaySender,
  currentUserId,
  currentUsername,
  onDelete,
  onReact,
  onReply,
  onRequestEdit,
}: MessageBubbleProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
  }, [message.id]);

  const rawVoiceUrl =
    (message.mediaUrl && message.mediaUrl.trim().length > 0 ? message.mediaUrl : undefined) ??
    extractVoiceUrlFromContent(message.content);
  const voicePlaybackUrl = rawVoiceUrl ? toPlayableAudioUrl(rawVoiceUrl) : undefined;
  const looksLikeAudioFile = Boolean(
    rawVoiceUrl && /\.(webm|ogg|opus|mp3|wav|m4a)(\?|#|$)/i.test(rawVoiceUrl)
  );
  const urlLooksLikeAudio = Boolean(
    voicePlaybackUrl && /\.(webm|ogg|opus|mp3|wav|m4a)(\?|#|$)/i.test(voicePlaybackUrl)
  );
  const showVoicePlayer = Boolean(
    voicePlaybackUrl &&
      (message.mediaType === "voice" ||
        isVoiceJsonContent(message.content) ||
        looksLikeAudioFile ||
        urlLooksLikeAudio ||
        (message.mediaType === "file" && looksLikeAudioFile))
  );
  /** Reply strip only when the message includes nested `parentMessage` (not `parentMessageId` alone). */
  const parentQuote = message.parentMessage;

  const receiptPhase = getReceiptPhase(message, isMine, currentUserId, currentUsername);
  const pendingStatusLabel =
    isMine && receiptPhase === "uploading"
      ? "Uploading…"
      : isMine && receiptPhase === "sending"
        ? "Sending…"
        : null;
  const tickPhase =
    isMine &&
    receiptPhase &&
    receiptPhase !== "uploading" &&
    receiptPhase !== "sending"
      ? receiptPhase
      : null;

  return (
    <div
      id={messageElementDomId(message.id)}
      data-msg-id={message.id}
      className={`group relative mb-6 flex w-full scroll-mt-4 ${isMine ? "justify-end" : "justify-start"}`}
    >
      {confirmDeleteOpen ? (
        <div
          className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[1px]"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !deleteBusy) setConfirmDeleteOpen(false);
          }}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
            role="dialog"
            aria-modal="true"
            aria-label="Delete message confirmation"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Delete this message?
            </h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              This action cannot be undone.
            </p>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                disabled={deleteBusy}
                onClick={() => setConfirmDeleteOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-xl bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 dark:bg-red-500 dark:hover:bg-red-600"
                disabled={deleteBusy}
                onClick={async () => {
                  setDeleteBusy(true);
                  try {
                    await onDelete(message.id);
                    setConfirmDeleteOpen(false);
                  } finally {
                    setDeleteBusy(false);
                  }
                }}
              >
                {deleteBusy ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      
      {/* 1. HOVER ACTIONS: Positioned outside the bubble to reduce clutter */}
      <div
        className={`absolute -top-8 z-20 flex items-center gap-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100 ${
          isMine ? "right-2" : "left-2"
        }`}
      >
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-slate-200 hover:bg-slate-50 dark:bg-slate-800 dark:ring-slate-700"
          title="Message actions"
          aria-label="Message actions"
        >
          <span className="text-xs">⋯</span>
        </button>
        {menuOpen ? (
          <div
            className={`absolute top-8 min-w-[120px] overflow-hidden rounded-xl border border-slate-200 bg-white py-1 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-800 ${
              isMine ? "right-0" : "left-0"
            }`}
          >
            <button
              type="button"
              className="block w-full px-3 py-1.5 text-left text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"
              onClick={() => {
                onReply(message);
                setMenuOpen(false);
              }}
            >
              Reply
            </button>
            {isMine && message.mediaType !== "voice" ? (
              <>
                <button
                  type="button"
                  className="block w-full px-3 py-1.5 text-left text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"
                  onClick={() => {
                    onRequestEdit(message);
                    setMenuOpen(false);
                  }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="block w-full px-3 py-1.5 text-left text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/40"
                  onClick={() => {
                    setMenuOpen(false);
                    setConfirmDeleteOpen(true);
                  }}
                >
                  Delete
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className={`relative flex flex-col ${isMine ? "items-end" : "items-start"}`}>
        {/* Sender Name */}
        {!isMine && (
          <span className="mb-1 ml-2 text-[11px] font-medium text-slate-500">
            {displaySender}
          </span>
        )}

        <div
          className={`relative max-w-sm px-4 py-3 text-sm transition-all duration-200 ${
            isMine
              ? "rounded-2xl rounded-tr-none bg-blue-600 text-white shadow-md"
              : "rounded-2xl rounded-tl-none bg-white text-slate-900 shadow-sm ring-1 ring-slate-100"
          }`}
        >
            <>
              {parentQuote ? (
                <button
                  type="button"
                  aria-label="Jump to quoted message"
                  className={`cursor-pointer mb-1 w-full rounded border-l-2 border-white/50 bg-white/10 p-2 text-left transition-opacity hover:opacity-90 active:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/90 ${
                    isMine ? "text-white/95" : "text-slate-700 ring-1 ring-slate-200/70"
                  }`}
                  onClick={() =>
                    scrollToMessage(
                      String(parentQuote.id ?? "").trim() ||
                        String(message.parentMessageId ?? "").trim()
                    )
                  }
                >
                  <p className={`text-[11px] font-semibold ${isMine ? "text-white" : "text-slate-800"}`}>
                    {parentQuote.sender?.trim() || "Reply"}
                  </p>
                  <p className={`truncate text-xs ${isMine ? "text-white/90" : "text-slate-600"}`}>
                    {getReplyTargetPreviewText(parentQuote)}
                  </p>
                </button>
              ) : null}

              {/* Message Content (never show raw voice JSON — player handles it) */}
              {message.content &&
              !showVoicePlayer &&
              message.mediaType !== "voice" &&
              !isVoiceJsonContent(message.content) ? (
                <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
              ) : null}

              {showVoicePlayer && voicePlaybackUrl ? (
                <VoiceMessagePlayer
                  src={voicePlaybackUrl}
                  hintDurationSec={message.voiceDurationSec}
                  isMine={isMine}
                />
              ) : message.mediaType === "voice" && !voicePlaybackUrl ? (
                <p className={`text-xs ${isMine ? "text-blue-100" : "text-slate-500"}`}>
                  Voice message (no audio URL from server)
                </p>
              ) : null}

              {isChatDebug() &&
                (message.mediaType === "voice" ||
                  looksLikeAudioFile ||
                  isVoiceJsonContent(message.content)) && (
                  <pre
                    className={`mt-2 max-h-32 max-w-full overflow-auto rounded p-2 font-mono text-[9px] leading-tight ${
                      isMine ? "bg-black/25 text-blue-50" : "bg-slate-100 text-slate-700"
                    }`}
                    spellCheck={false}
                  >
                    {JSON.stringify(
                      {
                        id: message.id,
                        mediaType: message.mediaType,
                        mediaUrl: message.mediaUrl,
                        voiceDurationSec: message.voiceDurationSec,
                        contentLen: message.content?.length ?? 0,
                        contentHead: message.content?.slice(0, 100) ?? "",
                        rawVoiceUrl,
                        voicePlaybackUrl,
                        showVoicePlayer,
                      },
                      null,
                      1
                    )}
                  </pre>
                )}

              {/* Image Attachments */}
              {message.mediaUrl && message.mediaType === "image" && (
                <a href={message.mediaUrl} target="_blank" rel="noreferrer" className="mt-2 block overflow-hidden rounded-lg">
                  <img src={message.mediaUrl} alt="Attachment" className="max-h-64 w-full object-cover transition-transform hover:scale-105" />
                </a>
              )}
              {message.mediaUrl && message.mediaType !== "image" && message.mediaType !== "voice" && (
                <a
                  href={message.mediaUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={`mt-2 inline-block rounded-md px-2 py-1 text-xs underline ${
                    isMine ? "bg-white/20 text-white" : "bg-slate-100 text-slate-700"
                  }`}
                >
                  {message.mediaName ? `Open ${message.mediaName}` : "Open attachment"}
                </a>
              )}

              {/* Status & Time */}
              <div
                className={`mt-1.5 flex flex-wrap items-center gap-1 text-[10px] ${isMine ? "text-blue-100/70" : "text-slate-400"}`}
              >
                {pendingStatusLabel ? <span>{pendingStatusLabel}</span> : null}
                <span>{formatShortTime(message.createdAt)}</span>
                {message.editedAt && <span>· Edited</span>}
                {tickPhase ? (
                  <span className="inline-flex items-center gap-0.5 transition-opacity duration-200">
                    <ReceiptTicks phase={tickPhase} isMineBubble={isMine} />
                  </span>
                ) : null}
                {tickPhase === "seen" && message.readAt && seenBySomeoneElse(message, currentUserId, currentUsername) ? (
                  <span className="opacity-90">· Seen {formatShortTime(message.readAt)}</span>
                ) : null}
              </div>
            </>

          {/* 3. REACTION BADGES: Floating at the bottom edge */}
          <div className="absolute -bottom-3 left-2 flex flex-wrap gap-1">
              {reactionDisplayEntries(message).map(([emoji, count]) => (
                (() => {
                  const currentUserKey = currentUserId != null ? String(currentUserId) : null;
                  const currentUsernameKey = currentUsername?.trim().toLowerCase() ?? "";
                  const reactedUsers = message.reactionUsers?.[emoji] ?? [];
                  const reactedByMe =
                    (currentUserKey != null && reactedUsers.includes(currentUserKey)) ||
                    (currentUsernameKey.length > 0 &&
                      reactedUsers.some((u) => u.trim().toLowerCase() === currentUsernameKey)) ||
                    message.myReaction === emoji;
                  return (
                    <button
                      key={emoji}
                      onClick={() => void onReact(message.id, emoji)}
                      className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] shadow-sm transition-all hover:scale-110 ${
                        reactedByMe
                          ? "border-blue-500 bg-blue-100"
                          : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800"
                      }`}
                    >
                      <span className="text-slate-900">{emoji}</span>
                      <span className="font-bold text-slate-600">{count}</span>
                    </button>
                  );
                })()
              ))}
              
              {/* Quick reaction picker: white pill (Messenger-style), visible on hover */}
              <div
                className={`pointer-events-none absolute -top-[3.25rem] z-10 opacity-0 transition-all duration-200 group-hover:pointer-events-auto group-hover:opacity-100 ${
                  isMine ? "right-0" : "left-0"
                }`}
              >
                <div
                  className={`flex items-center gap-0.5 rounded-full border border-slate-200/90 bg-white px-2 py-1.5 shadow-[0_4px_24px_rgba(15,23,42,0.14)] ring-1 ring-black/[0.04] dark:border-slate-600 dark:bg-slate-800 dark:ring-white/10 ${
                    isMine ? "origin-bottom-right" : "origin-bottom-left"
                  }`}
                >
                  {QUICK_REACTIONS.map((emoji) => {
                    const mineSticker = message.myReaction === emoji;
                    return (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => void onReact(message.id, emoji)}
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-2xl leading-none transition-transform active:scale-90 ${
                          mineSticker
                            ? "border-2 border-blue-500 bg-blue-100 text-slate-900 ring-2 ring-blue-400/35 dark:bg-blue-950/55 dark:text-slate-100 dark:ring-blue-500/30"
                            : "border-2 border-transparent text-slate-900 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-700"
                        }`}
                        title={mineSticker ? `Your reaction (${emoji})` : `React ${emoji}`}
                        aria-label={`React ${emoji}`}
                        aria-pressed={mineSticker}
                      >
                        {emoji}
                      </button>
                    );
                  })}
                </div>
              </div>
          </div>
        </div>
      </div>
    </div>
  );
}