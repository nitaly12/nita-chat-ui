"use client";

import { useEffect, useState } from "react";
import { CHAT_BACKEND_ORIGIN } from "../../chat/api";
import { isChatDebug } from "../../chat/chatDebug";
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
  onEdit: (messageId: string, content: string) => Promise<void>;
  onDelete: (messageId: string) => Promise<void>;
  onReact: (messageId: string, emoji: string) => Promise<void>;
};

const formatShortTime = (iso: string): string =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

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
  onEdit,
  onDelete,
  onReact,
}: MessageBubbleProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);

  useEffect(() => {
    setDraft(message.content);
  }, [message.content, message.id]);

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
    <div className={`group relative mb-6 flex w-full ${isMine ? "justify-end" : "justify-start"}`}>
      
      {/* 1. HOVER ACTIONS: Positioned outside the bubble to reduce clutter */}
      {!isEditing && isMine && message.mediaType !== "voice" && (
        <div className="absolute -top-8 right-2 flex items-center gap-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          <button
            onClick={() => setIsEditing(true)}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-slate-200 hover:bg-slate-50 dark:bg-slate-800 dark:ring-slate-700"
            title="Edit"
          >
            <span className="text-xs">✏️</span>
          </button>
          <button
            onClick={() => {
              if (window.confirm("Delete this message?")) void onDelete(message.id);
            }}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-slate-200 hover:bg-red-50 dark:bg-slate-800 dark:ring-slate-700"
            title="Delete"
          >
            <span className="text-xs text-red-500">🗑️</span>
          </button>
        </div>
      )}

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
          {/* 2. EDITING STATE */}
          {isEditing ? (
            <div className="min-w-[200px] space-y-2">
              <textarea
                className="w-full rounded-lg border-none bg-black/10 p-2 text-white placeholder:text-white/50 focus:ring-1 focus:ring-white/30"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={2}
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <button
                  className="rounded-full bg-white/20 px-3 py-1 text-[10px] font-bold uppercase tracking-wider hover:bg-white/30"
                  onClick={() => setIsEditing(false)}
                >
                  Cancel
                </button>
                <button
                  className="rounded-full bg-white px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-blue-600 hover:bg-blue-50"
                  onClick={async () => {
                    await onEdit(message.id, draft.trim());
                    setIsEditing(false);
                  }}
                >
                  Save
                </button>
              </div>
            </div>
          ) : (
            <>
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
          )}

          {/* 3. REACTION BADGES: Floating at the bottom edge */}
          {!isEditing && (
            <div className="absolute -bottom-3 left-2 flex flex-wrap gap-1">
              {(Object.entries(message.reactions ?? {}) as Array<[string, number]>).map(([emoji, count]) => (
                <button
                  key={emoji}
                  onClick={() => void onReact(message.id, emoji)}
                  className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] shadow-sm ring-1 transition-all hover:scale-110 ${
                    message.myReaction === emoji
                      ? "bg-amber-100 ring-amber-300"
                      : "bg-white ring-slate-200 dark:bg-slate-800 dark:ring-slate-700"
                  }`}
                >
                  <span className="text-slate-900">{emoji}</span>
                  <span className="font-bold text-slate-600">{count}</span>
                </button>
              ))}
              
              {/* Quick Add Reaction Button: Visible on Hover */}
              <button
                onClick={() => void onReact(message.id, "👍")}
                className="flex h-5 items-center justify-center rounded-full bg-white px-2 text-[10px] opacity-0 shadow-sm ring-1 ring-slate-200 transition-opacity group-hover:opacity-100 dark:bg-slate-800 dark:ring-slate-700"
              >
                +😊
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}