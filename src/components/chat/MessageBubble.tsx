"use client";

import { useEffect, useState } from "react";
import type { ChatMessage } from "../../chat/types";

type MessageBubbleProps = {
  message: ChatMessage;
  isMine: boolean;
  displaySender: string;
  onEdit: (messageId: string, content: string) => Promise<void>;
  onDelete: (messageId: string) => Promise<void>;
  onReact: (messageId: string, emoji: string) => Promise<void>;
};

const formatShortTime = (iso: string): string =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const deliveryStatus = (message: ChatMessage): string => {
  if (message.pending) return "Sending…";
  if (message.readAt || message.seen || (message.readBy && message.readBy.length > 0)) {
    return "Read";
  }
  return "Delivered";
};

export default function MessageBubble({
  message,
  isMine,
  displaySender,
  onEdit,
  onDelete,
  onReact,
}: MessageBubbleProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);

  useEffect(() => {
    setDraft(message.content);
  }, [message.content, message.id]);

  return (
    <div className={`group relative mb-6 flex w-full ${isMine ? "justify-end" : "justify-start"}`}>
      
      {/* 1. HOVER ACTIONS: Positioned outside the bubble to reduce clutter */}
      {!isEditing && isMine && (
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
              {/* Message Content */}
              {message.content && <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>}
              
              {/* Image Attachments */}
              {message.mediaUrl && message.mediaType === "image" && (
                <a href={message.mediaUrl} target="_blank" rel="noreferrer" className="mt-2 block overflow-hidden rounded-lg">
                  <img src={message.mediaUrl} alt="Attachment" className="max-h-64 w-full object-cover transition-transform hover:scale-105" />
                </a>
              )}
              {message.mediaUrl && message.mediaType !== "image" && (
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
              <div className={`mt-1.5 flex items-center gap-1 text-[10px] ${isMine ? "text-blue-100/70" : "text-slate-400"}`}>
                <span>{formatShortTime(message.createdAt)}</span>
                {message.editedAt && <span>· Edited</span>}
                {isMine && <span>· {deliveryStatus(message)}</span>}
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