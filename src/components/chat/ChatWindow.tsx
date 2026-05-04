"use client";

import { useEffect, useRef, useState } from "react";
import type { Chat, ChatMessage, UserSummary } from "../../chat/types";
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
  onSend: (content: string) => Promise<void>;
  onEdit: (messageId: string, content: string) => Promise<void>;
  onDelete: (messageId: string) => Promise<void>;
  onReact: (messageId: string, emoji: string) => Promise<void>;
  onSendMedia: (file: File) => Promise<void>;
  onInvite: (userId: string) => Promise<void>;
  onRemoveMember?: (userId: string) => Promise<void>;
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
  onInvite,
  onRemoveMember,
}: ChatWindowProps) {
  const [draft, setDraft] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [nickname, setNickname] = useState("");
  const [nicknameDraft, setNicknameDraft] = useState("");
  const [theme, setTheme] = useState<"default" | "warm" | "dark">("default");
  const [inviteUserId, setInviteUserId] = useState("");
  const [membersOpen, setMembersOpen] = useState(true);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const typingThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  const themeClass =
    theme === "dark"
      ? "bg-slate-900 text-slate-100"
      : theme === "warm"
        ? "bg-amber-50 text-slate-900"
        : "bg-white";
  const sectionClass =
    theme === "dark"
      ? "bg-slate-800/80"
      : theme === "warm"
        ? "bg-amber-50/60"
        : "bg-slate-50/50";

  if (!activeChat) {
    return (
      <main className="flex flex-1 items-center justify-center bg-slate-100 text-slate-500">
        Select or start a conversation
      </main>
    );
  }

  const members = activeChat.members ?? [];
  const resolvedChatTitle = (() => {
    if (activeChat.isGroup) return activeChat.groupName || "Group";
    const other = members.find((m) => {
      const uname = m.username ?? m.name;
      if (!uname) return false;
      if (!currentUsername) return true;
      return uname !== currentUsername;
    });
    return (
      other?.username ??
      other?.name ??
      activeChat.directName ??
      activeChat.groupName ??
      `Chat #${activeChat.id}`
    );
  })();
  const effectiveTitle = nickname.trim().length > 0 ? nickname.trim() : resolvedChatTitle;
  const resolvedPrivateStatus = (() => {
    if (activeChat.isGroup) return `${members.length} members`;
    const other = members.find((m) => {
      const uname = m.username ?? m.name;
      if (!uname) return false;
      if (!currentUsername) return true;
      return uname !== currentUsername;
    });
    const memberOnline = other?.online ?? other?.isOnline;
    if (typeof memberOnline === "boolean") return memberOnline ? "Online" : "Offline";
    const keyUsername = other?.username ?? other?.name;
    const keyId = other?.id;
    const fromUsers = users.find(
      (u) => (keyId && u.id === keyId) || (keyUsername && u.username === keyUsername)
    );
    if (typeof fromUsers?.online === "boolean") return fromUsers.online ? "Online" : "Offline";
    return "Offline";
  })();

  return (
    <main className={`flex flex-1 flex-col ${themeClass}`}>
      <header className="border-b border-slate-200 bg-white px-6 py-4">
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
          <div className="min-w-0">
            <h2 className="truncate text-xl font-semibold text-slate-900">{effectiveTitle}</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              {typingLabel ?? resolvedPrivateStatus}
            </p>
          </div>
          <div className="relative flex items-center gap-2">
            <button className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-sm">
              📞
            </button>
            <button className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-sm">
              🎥
            </button>
            {searchOpen && (
              <input
                className="h-9 w-64 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs outline-none focus:border-blue-500"
                placeholder="Search messages in this room..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            )}
            <button
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-sm"
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              title="Search messages"
            >
              ⋯
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-11 z-20 w-72 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
                <button
                  type="button"
                  className="w-full rounded-xl px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-100"
                  onClick={() => {
                    setSearchOpen((v) => !v);
                    setMenuOpen(false);
                  }}
                >
                  {searchOpen ? "Hide search" : "Search messages"}
                </button>
                <button
                  type="button"
                  className="w-full rounded-xl px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-100"
                  onClick={() => {
                    setProfileOpen((v) => !v);
                    setMenuOpen(false);
                  }}
                >
                  {profileOpen ? "Hide profile" : "View profile"}
                </button>
                <div className="my-2 border-t border-slate-100" />
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
                <div className="my-2 border-t border-slate-100" />
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
        {profileOpen && (
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
            <p>
              <span className="font-semibold">Name:</span> {resolvedChatTitle}
            </p>
            <p>
              <span className="font-semibold">Room ID:</span> {activeChat.id}
            </p>
            <p>
              <span className="font-semibold">Status:</span> {resolvedPrivateStatus}
            </p>
          </div>
        )}
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

            <div className="rounded-lg border border-slate-200 bg-slate-50">
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

      <section className={`min-h-0 flex-1 space-y-4 overflow-y-auto p-6 ${sectionClass}`}>
        {filteredMessages.map((message, index) => {
          const isMine =
            (currentUserId && message.senderId === currentUserId) ||
            (currentUsername && message.sender === currentUsername) ||
            Boolean(message.mine);
          const senderLabel = isMine ? "You" : message.sender;
          return (
            <MessageBubble
              key={`${message.id}-${message.createdAt}-${index}`}
              message={message}
              isMine={Boolean(isMine)}
              displaySender={senderLabel}
              onEdit={onEdit}
              onDelete={onDelete}
              onReact={onReact}
            />
          );
        })}
        <div ref={bottomRef} />
      </section>

      <footer className="border-t border-slate-200 bg-white p-4">
        <form
          className="flex items-center gap-2 rounded-2xl border border-blue-300 bg-white p-2 shadow-sm"
          onSubmit={async (e) => {
            e.preventDefault();
            const content = draft.trim();
            if (!content) return;
            setDraft("");
            await onSend(content);
          }}
        >
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
            placeholder="Type a message..."
          />
          <button
            className="rounded-xl bg-gradient-to-b from-blue-500 to-blue-700 px-5 py-2.5 text-sm font-semibold text-white shadow hover:from-blue-600 hover:to-blue-700"
            type="submit"
          >
            Send
          </button>
        </form>
      </footer>
    </main>
  );
}
