"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  avatarTone,
  directPeerRef,
  pickUserSummary,
  resolveChatAvatarUrl,
  resolveChatName,
  resolveOtherOnline,
} from "../../chat/chatPeerProfile";
import { getReplyTargetPreviewText } from "../../chat/replyPreview";
import type { Chat, ChatMessage, UserSummary } from "../../chat/types";
import { useVoiceRecorder } from "../../hooks/useVoiceRecorder";
import MessageBubble from "./MessageBubble";

type ChatWindowProps = {
  activeChat: Chat | null;
  messages: ChatMessage[];
  users: UserSummary[];
  currentUserId: string | null;
  currentUsername: string | null;
  typingUsers: string[];
  onTypingActivity: () => void;
  notice: string;
  onDismissNotice: () => void;
  /** Called after opening a room (debounced) to sync read receipts server-side if supported */
  onMarkRead: () => void;
  onSend: (content: string, parentMessageId?: string) => Promise<void>;
  onEdit: (messageId: string, content: string) => Promise<void>;
  onDelete: (messageId: string) => Promise<void>;
  onReact: (messageId: string, emoji: string) => Promise<void>;
  onSendMedia: (file: File) => Promise<void>;
  onSendVoice: (blob: Blob, durationSec: number) => Promise<void>;
  onInvite: (userId: string) => Promise<void>;
  onRemoveMember?: (userId: string) => Promise<void>;
  /** Mobile-only: dismiss the open chat and return to the sidebar. */
  onClose?: () => void;
};

export default function ChatWindow({
  activeChat,
  messages,
  users,
  currentUserId,
  currentUsername,
  typingUsers,
  onTypingActivity,
  notice,
  onDismissNotice,
  onMarkRead,
  onSend,
  onEdit,
  onDelete,
  onReact,
  onSendMedia,
  onSendVoice,
  onInvite,
  onRemoveMember,
  onClose,
}: ChatWindowProps) {
  const [draft, setDraft] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [nickname, setNickname] = useState("");
  const [nicknameDraft, setNicknameDraft] = useState("");
  const [theme, setTheme] = useState<"default" | "warm" | "dark">("default");
  const [inviteUserId, setInviteUserId] = useState("");
  const [membersOpen, setMembersOpen] = useState(false);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const typingThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voice = useVoiceRecorder();
  const recordingActive = voice.uiState !== "idle";

  const formatRecSec = (sec: number): string => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    return () => {
      if (typingThrottleRef.current) clearTimeout(typingThrottleRef.current);
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    setNicknameDraft(nickname);
  }, [menuOpen, nickname]);

  useEffect(() => {
    if (!activeChat?.id) return;
    const t = window.setTimeout(() => {
      void onMarkRead();
    }, 700);
    return () => window.clearTimeout(t);
  }, [activeChat?.id, onMarkRead]);

  useEffect(() => {
    setReplyingTo(null);
    setEditingMessage(null);
  }, [activeChat?.id]);

  const typingLabel =
    typingUsers.length === 0
      ? null
      : typingUsers.length === 1
        ? `${typingUsers[0]} is typing…`
        : `${typingUsers.slice(0, 2).join(", ")}${typingUsers.length > 2 ? "…" : ""} are typing…`;
  const normalizedQuery = searchTerm.trim().toLowerCase();
  const filteredMessages =
    normalizedQuery.length === 0
      ? messages
      : messages.filter((m) => {
          const text = `${m.sender} ${m.content}`.toLowerCase();
          return text.includes(normalizedQuery);
        });
  const messageById = useMemo(() => {
    const map = new Map<string, ChatMessage>();
    for (const m of messages) map.set(String(m.id), m);
    return map;
  }, [messages]);
  const themeClass =
    theme === "dark"
      ? "bg-slate-900 text-slate-100"
      : theme === "warm"
        ? "bg-amber-50 text-slate-900"
        : "bg-white dark:bg-slate-900 dark:text-slate-100";
  const sectionClass =
    theme === "dark"
      ? "bg-slate-800/80"
      : theme === "warm"
        ? "bg-amber-50/60"
        : "bg-slate-50/50 dark:bg-slate-950/80 dark:text-slate-100";

  const peerProfileHref = useMemo(() => {
    if (!activeChat || activeChat.isGroup) return null;
    const peer = directPeerRef(activeChat, currentUsername);
    const row = pickUserSummary(users, peer);
    const uname = row?.username?.trim() || peer?.username?.trim();
    if (!uname) return null;
    return `/users/${encodeURIComponent(uname)}`;
  }, [activeChat, currentUsername, users]);

  if (!activeChat) {
    return (
      <main className="hidden flex-1 items-center justify-center bg-slate-100 text-slate-500 dark:bg-slate-900 dark:text-slate-400 md:flex">
        Select or start a conversation
      </main>
    );
  }

  const members = activeChat.members ?? [];
  const resolvedChatTitle = resolveChatName(activeChat, currentUsername, users);
  const effectiveTitle = nickname.trim().length > 0 ? nickname.trim() : resolvedChatTitle;
  const headerAvatarUrl = resolveChatAvatarUrl(activeChat, currentUsername, users);
  const headerInitials = effectiveTitle.slice(0, 1).toUpperCase();
  const resolvedPrivateStatus = activeChat.isGroup
    ? `${members.length} members`
    : resolveOtherOnline(activeChat, currentUsername, users)
      ? "Online"
      : "Offline";

  return (
    <main className={`flex flex-1 flex-col ${themeClass}`}>
      <header className="border-b border-slate-200 bg-white px-6 py-4 dark:border-slate-700 dark:bg-slate-900">
        {notice ? (
          <div className="mb-3 flex items-start justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <span className="min-w-0 flex-1">{notice}</span>
            <button
              className="shrink-0 rounded px-2 py-0.5 text-xs text-amber-800 hover:bg-amber-100"
              type="button"
              onClick={onDismissNotice}
            >
              Dismiss
            </button>
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {onClose ? (
              <button
                type="button"
                onClick={onClose}
                aria-label="Back to chats"
                className="-ml-2 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 md:hidden"
              >
                <span aria-hidden className="inline-flex text-slate-600 dark:text-slate-300">
                  <svg
                    className="h-6 w-6"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M15 18l-6-6 6-6" />
                  </svg>
                </span>
              </button>
            ) : null}
            <div className="relative shrink-0">
              <div
                className={`inline-flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200/80 text-base font-semibold dark:border-slate-600 ${
                  headerAvatarUrl
                    ? "bg-slate-100 dark:bg-slate-800"
                    : `text-slate-800 dark:text-slate-900 ${avatarTone(effectiveTitle)}`
                }`}
              >
                {headerAvatarUrl ? (
                  <img
                    src={headerAvatarUrl}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="eager"
                    decoding="async"
                  />
                ) : (
                  headerInitials
                )}
              </div>
              {!activeChat.isGroup ? (
                <span
                  className={`absolute bottom-0 right-0 inline-block h-2.5 w-2.5 rounded-full border border-white dark:border-slate-900 ${
                    resolveOtherOnline(activeChat, currentUsername, users)
                      ? "bg-green-500"
                      : "bg-slate-300"
                  }`}
                />
              ) : null}
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-xl font-semibold text-slate-900 dark:text-slate-100">
                {effectiveTitle}
              </h2>
              <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                {typingLabel ?? resolvedPrivateStatus}
              </p>
            </div>
          </div>
          <div className="relative flex items-center gap-2">
            <button className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-sm dark:border-slate-600 dark:text-slate-200">
              📞
            </button>
            <button className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-sm dark:border-slate-600 dark:text-slate-200">
              🎥
            </button>
            {searchOpen && (
              <input
                className="h-9 w-64 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs text-slate-900 outline-none focus:border-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                placeholder="Search messages in this room..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            )}
            <button
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-sm dark:border-slate-600 dark:text-slate-200"
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              title="Search messages"
            >
              ⋯
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-11 z-20 w-72 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-600 dark:bg-slate-800">
                <button
                  type="button"
                  className="w-full rounded-xl px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"
                  onClick={() => {
                    setSearchOpen((v) => !v);
                    setMenuOpen(false);
                  }}
                >
                  {searchOpen ? "Hide search" : "Search messages"}
                </button>
                {peerProfileHref ? (
                  <Link
                    href={peerProfileHref}
                    className="block w-full rounded-xl px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"
                    onClick={() => setMenuOpen(false)}
                  >
                    View profile
                  </Link>
                ) : (
                  <p className="rounded-xl px-3 py-2 text-left text-xs text-slate-400 dark:text-slate-500">
                    Profile link is available in direct chats when the other person has a
                    username.
                  </p>
                )}
                <div className="my-2 border-t border-slate-100 dark:border-slate-600" />
                <div className="px-1 pb-1">
                  <p className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    Change nickname
                  </p>
                  <div className="flex items-center gap-2 px-2">
                    <input
                      value={nicknameDraft}
                      onChange={(e) => setNicknameDraft(e.target.value)}
                      placeholder={resolvedChatTitle}
                      className="h-9 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs outline-none focus:border-blue-500"
                    />
                    <button
                      type="button"
                      className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700"
                      onClick={() => {
                        setNickname(nicknameDraft.trim());
                        setMenuOpen(false);
                      }}
                    >
                      Save
                    </button>
                  </div>
                </div>
                <div className="my-2 border-t border-slate-100 dark:border-slate-600" />
                <div className="px-1 pb-1">
                  <p className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    Chat theme
                  </p>
                  <div className="grid grid-cols-3 gap-2 px-2">
                    <button
                      type="button"
                      className={`rounded-lg px-2 py-2 text-xs font-medium ${
                        theme === "default"
                          ? "bg-slate-900 text-white"
                          : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                      }`}
                      onClick={() => {
                        setTheme("default");
                        setMenuOpen(false);
                      }}
                    >
                      Default
                    </button>
                    <button
                      type="button"
                      className={`rounded-lg px-2 py-2 text-xs font-medium ${
                        theme === "warm"
                          ? "bg-amber-500 text-white"
                          : "bg-amber-100 text-amber-800 hover:bg-amber-200"
                      }`}
                      onClick={() => {
                        setTheme("warm");
                        setMenuOpen(false);
                      }}
                    >
                      Warm
                    </button>
                    <button
                      type="button"
                      className={`rounded-lg px-2 py-2 text-xs font-medium ${
                        theme === "dark"
                          ? "bg-slate-700 text-white"
                          : "bg-slate-200 text-slate-700 hover:bg-slate-300"
                      }`}
                      onClick={() => {
                        setTheme("dark");
                        setMenuOpen(false);
                      }}
                    >
                      Dark
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
        {activeChat.isGroup && (
          <div className="mt-3 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <input
                className="min-w-[8rem] flex-1 rounded-md border border-slate-300 px-2 py-1 text-xs"
                placeholder="User ID to invite"
                value={inviteUserId}
                onChange={(e) => setInviteUserId(e.target.value)}
              />
              <button
                className="rounded-md bg-slate-800 px-2 py-1 text-xs text-white"
                type="button"
                onClick={async () => {
                  const value = inviteUserId.trim();
                  if (!value) return;
                  await onInvite(value);
                  setInviteUserId("");
                }}
              >
                Invite
              </button>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-600 dark:bg-slate-800/80">
              <button
                type="button"
                className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600"
                onClick={() => setMembersOpen((o) => !o)}
              >
                <span>Members ({members.length})</span>
                <span className="text-slate-400">{membersOpen ? "−" : "+"}</span>
              </button>
              {membersOpen && (
                <ul className="max-h-40 space-y-1 overflow-y-auto border-t border-slate-200 px-2 py-2">
                  {members.length === 0 && (
                    <li className="px-1 text-xs text-slate-500">No member list from server.</li>
                  )}
                  {members.map((m, index) => {
                    const label = m.username ?? m.name ?? "Unknown";
                    const online = Boolean(m.online ?? m.isOnline);
                    const canRemove =
                      Boolean(onRemoveMember && m.id && currentUserId && m.id !== currentUserId);
                    return (
                      <li
                        key={`${m.id ?? "noid"}-${index}-${label}`}
                        className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-white"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <span
                            className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                              online ? "bg-green-500" : "bg-slate-300"
                            }`}
                            title={online ? "Online" : "Offline"}
                          />
                          <span className="truncate font-medium text-slate-800">{label}</span>
                          {m.id && (
                            <span className="truncate text-[10px] text-slate-400">#{m.id}</span>
                          )}
                        </div>
                        {canRemove && (
                          <button
                            type="button"
                            className="shrink-0 rounded bg-red-100 px-2 py-0.5 text-[11px] text-red-800 hover:bg-red-200"
                            onClick={() => {
                              if (!window.confirm(`Remove ${label} from this group?`)) return;
                              void onRemoveMember?.(m.id as string);
                            }}
                          >
                            Remove
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        )}
      </header>

      <section className={`min-h-0 flex-1 space-y-4 overflow-x-hidden overflow-y-auto p-6 ${sectionClass}`}>
        {filteredMessages.map((message, index) => {
          const resolvedParent =
            message.parentMessage ??
            (message.parentMessageId
              ? (() => {
                  const p = messageById.get(String(message.parentMessageId));
                  if (!p) return undefined;
                  return {
                    id: String(p.id),
                    sender: p.sender,
                    content: p.content,
                  };
                })()
              : undefined);
          const withResolvedParent =
            resolvedParent && !message.parentMessage
              ? { ...message, parentMessage: resolvedParent }
              : message;
          const isMine =
            (currentUserId && withResolvedParent.senderId === currentUserId) ||
            (currentUsername && withResolvedParent.sender === currentUsername) ||
            Boolean(withResolvedParent.mine);
          const senderLabel = isMine ? "You" : withResolvedParent.sender;
          return (
            <MessageBubble
              key={`${withResolvedParent.id}-${withResolvedParent.createdAt}-${index}`}
              message={withResolvedParent}
              isMine={Boolean(isMine)}
              displaySender={senderLabel}
              currentUserId={currentUserId}
              currentUsername={currentUsername}
              onDelete={onDelete}
              onReact={onReact}
              onReply={(msg) => setReplyingTo(msg)}
              onRequestEdit={(msg) => {
                setEditingMessage(msg);
                setReplyingTo(null);
                setDraft(msg.content ?? "");
              }}
            />
          );
        })}
        <div ref={bottomRef} />
      </section>

      <footer className="border-t border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-stretch gap-2">
          <button
            type="button"
            title="Hold to record voice"
            className="inline-flex shrink-0 cursor-pointer select-none items-center self-end rounded-xl bg-slate-100 px-3 py-3 text-sm text-slate-700 hover:bg-slate-200 active:bg-slate-300"
            onPointerDown={(e) => {
              e.preventDefault();
              (e.currentTarget as HTMLButtonElement).setPointerCapture(e.pointerId);
              void voice.startRecording(e.clientX);
            }}
            onPointerMove={(e) => {
              if (voice.uiState === "recording") voice.onPointerMove(e.clientX);
            }}
            onPointerUp={(e) => {
              const el = e.currentTarget as HTMLButtonElement;
              if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
              const phase = voice.getPhase();
              if (phase === "idle") return;
              if (phase === "requesting") {
                voice.cancelPendingStart();
                return;
              }
              const cancelled = voice.getSlideToCancel();
              void (async () => {
                const result = await voice.stopRecording(cancelled);
                if (result && !cancelled) await onSendVoice(result.blob, result.durationSec);
              })();
            }}
            onPointerCancel={(e) => {
              const el = e.currentTarget as HTMLButtonElement;
              if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
              const phase = voice.getPhase();
              if (phase === "requesting") voice.cancelPendingStart();
              else if (phase === "recording") void voice.stopRecording(true);
            }}
          >
            🎤
          </button>

          <div className="min-w-0 flex-1">
            {recordingActive ? (
              <div
                className={`flex h-full min-h-[52px] items-center gap-3 rounded-2xl border px-4 py-3 shadow-sm ${
                  voice.slideToCancel
                    ? "border-red-300 bg-red-50"
                    : "border-amber-200 bg-amber-50/80"
                }`}
              >
                <span className="relative flex h-3 w-3 shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-60" />
                  <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500" />
                </span>
                <span className="font-mono text-lg font-semibold tabular-nums text-slate-800">
                  {voice.uiState === "requesting" ? "…" : formatRecSec(voice.elapsedSec)}
                </span>
                <p className="min-w-0 flex-1 text-center text-sm text-slate-700">
                  {voice.uiState === "requesting"
                    ? "Allow microphone access…"
                    : voice.slideToCancel
                      ? "Release to cancel"
                      : "Release to send · slide left to cancel"}
                </p>
                <div className="hidden h-8 shrink-0 items-end gap-0.5 sm:flex">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <span
                      key={i}
                      className="w-1 rounded-full bg-red-400/80 animate-pulse"
                      style={{ height: `${6 + (i % 4) * 4}px`, animationDelay: `${i * 80}ms` }}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <form
                className="flex flex-col gap-2 rounded-2xl border border-blue-300 bg-white p-2 shadow-sm"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const content = draft.trim();
                  if (!content) return;
                  if (editingMessage) {
                    await onEdit(editingMessage.id, content);
                    setEditingMessage(null);
                    setDraft("");
                    return;
                  }
                  const parentMessageId = replyingTo?.id;
                  setDraft("");
                  await onSend(content, parentMessageId);
                  setReplyingTo(null);
                }}
              >
                {editingMessage ? (
                  <div className="mb-2 w-full rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs text-slate-700">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-amber-700">Editing message</p>
                        <p className="truncate text-slate-600">
                          {(editingMessage.content || "").trim() || "Attachment"}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="rounded-md px-1.5 py-0.5 text-slate-500 hover:bg-amber-100 hover:text-slate-700"
                        onClick={() => {
                          setEditingMessage(null);
                          setDraft("");
                        }}
                        aria-label="Cancel edit"
                        title="Cancel edit"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ) : null}
                {replyingTo ? (
                  <div className="mb-2 w-full rounded-xl border border-blue-200 bg-blue-50/70 px-3 py-2 text-xs text-slate-700">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-blue-700">
                          Replying to {replyingTo.sender || "Message"}
                        </p>
                        <p className="truncate text-slate-600">
                          {getReplyTargetPreviewText(replyingTo)}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="rounded-md px-1.5 py-0.5 text-slate-500 hover:bg-blue-100 hover:text-slate-700"
                        onClick={() => setReplyingTo(null)}
                        aria-label="Cancel reply"
                        title="Cancel reply"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ) : null}
                <div className="flex w-full items-center gap-2">
                <label className="inline-flex cursor-pointer items-center rounded-xl bg-slate-100 px-3 py-3 text-xs text-slate-700 hover:bg-slate-200">
                  📎
                  <input
                    type="file"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      void onSendMedia(file);
                      e.currentTarget.value = "";
                    }}
                  />
                </label>
                <input
                  className="flex-1 rounded-xl border border-transparent bg-transparent px-2 py-2 text-sm outline-none"
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    if (!typingThrottleRef.current) {
                      onTypingActivity();
                      typingThrottleRef.current = setTimeout(() => {
                        typingThrottleRef.current = null;
                      }, 900);
                    }
                  }}
                  placeholder="Type a message…"
                />
                <button
                  className="rounded-xl bg-gradient-to-b from-blue-500 to-blue-700 px-5 py-2.5 text-sm font-semibold text-white shadow hover:from-blue-600 hover:to-blue-700"
                  type="submit"
                >
                  {editingMessage ? "Save" : "Send"}
                </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </footer>
    </main>
  );
}
