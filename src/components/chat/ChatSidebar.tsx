"use client";

import {
  avatarTone,
  resolveChatAvatarUrl,
  resolveChatName,
  resolveOtherOnline,
} from "../../chat/chatPeerProfile";
import type { Chat, UserSummary } from "../../chat/types";

type ChatSidebarProps = {
  chats: Chat[];
  activeRoomId: string;
  currentUsername: string | null;
  users: UserSummary[];
  /** Extra unread bumps when last preview changes (non-active rooms). */
  extraUnreadByRoom: Record<string, number>;
  onSelectRoom: (roomId: string) => void;
  onStartPrivateChat: (userId: string) => void;
  onCreateGroup: () => void;
  onLogout: () => void;
};

const relativeTime = (iso?: string): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const day = Math.floor(h / 24);
  return `${day}d ago`;
};

const displayUnread = (
  chat: Chat,
  activeRoomId: string,
  extra: Record<string, number>
): number => {
  if (chat.id === activeRoomId) return 0;
  const server = chat.unreadCount ?? 0;
  const local = extra[chat.id] ?? 0;
  return Math.max(0, server + local);
};

export default function ChatSidebar({
  chats,
  activeRoomId,
  currentUsername,
  users,
  extraUnreadByRoom,
  onSelectRoom,
  onStartPrivateChat,
  onCreateGroup,
  onLogout,
}: ChatSidebarProps) {
  const totalUnread = chats.reduce(
    (sum, c) => sum + displayUnread(c, activeRoomId, extraUnreadByRoom),
    0
  );
  return (
    <aside className="flex h-full w-[340px] flex-col border-r border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      <div className="border-b border-slate-200 p-5 dark:border-slate-700">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">Message</h1>
          <button
            type="button"
            className="inline-flex cursor-pointer h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-b from-blue-500 to-blue-700 text-lg font-semibold text-white shadow hover:from-blue-600 hover:to-blue-800"
            title="New group"
            aria-label="New group"
            onClick={onCreateGroup}
          >
            +
          </button>
        </div> 
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Checkout your conversation</p>
      </div>

      <div className="flex border-b border-slate-200 text-sm font-medium dark:border-slate-700">
        <button
          type="button"
          className="flex-1 border-b-2 border-blue-500 px-3 py-3 text-blue-600 dark:border-blue-400 dark:text-blue-400"
        >
          All ({chats.length})
        </button>
        <button
          type="button"
          className="flex-1 px-3 py-3 text-slate-500 dark:text-slate-400"
        >
          Unread ({totalUnread})
        </button>
      </div>

      <div className="border-b border-slate-200 p-3 dark:border-slate-700">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Quick Start
        </p>
        <div className="max-h-28 space-y-1 overflow-y-auto">
          {users.slice(0, 8).map((user) => (
            <button
              key={user.id}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
              type="button"
              onClick={() => onStartPrivateChat(user.id)}
            >
              <span
                className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                  user.online ? "bg-green-500" : "bg-slate-300"
                }`}
              />
              <span className="min-w-0 truncate">{user.username}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto divide-y divide-slate-200 dark:divide-slate-700">
        {chats.map((chat) => {
          const unread = displayUnread(chat, activeRoomId, extraUnreadByRoom);
          const online = resolveOtherOnline(chat, currentUsername, users);
          const title = resolveChatName(chat, currentUsername, users);
          const time = relativeTime(chat.lastMessageAt);
          const initials = title.slice(0, 1).toUpperCase();
          const avatarUrl = resolveChatAvatarUrl(chat, currentUsername, users);
          const hasLastMessage = Boolean(chat.lastMessagePreview?.trim());
          return (
            <button
              key={chat.id}
              type="button"
              onClick={() => onSelectRoom(chat.id)}
              className={`w-full px-4 py-3 text-left transition ${
                activeRoomId === chat.id
                  ? "bg-slate-100 dark:bg-slate-800"
                  : "bg-white hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800"
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="relative shrink-0">
                  <div
                    className={`inline-flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200/80 text-sm font-semibold dark:border-slate-600 ${
                      avatarUrl
                        ? "bg-slate-100 dark:bg-slate-800"
                        : `text-slate-800 dark:text-slate-900 ${avatarTone(title)}`
                    }`}
                  >
                    {avatarUrl ? (
                      <img
                        src={avatarUrl}
                        alt=""
                        className="h-full w-full object-cover"
                        loading="eager"
                        decoding="async"
                      />
                    ) : (
                      initials
                    )}
                  </div>
                  <span
                    className={`absolute bottom-0 right-0 inline-block h-2.5 w-2.5 rounded-full border border-white ${
                      online ? "bg-green-500" : "bg-slate-300"
                    }`}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-[15px] font-semibold text-slate-900 dark:text-slate-100">
                      {title}
                    </p>
                    <p className="shrink-0 text-xs text-slate-400 dark:text-slate-500">{time}</p>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span
                      className={`truncate text-sm ${
                        unread > 0
                          ? "font-medium text-slate-800 dark:text-slate-200"
                          : "text-slate-600 dark:text-slate-400"
                      }`}
                    >
                      {chat.lastMessagePreview || "No messages yet"}
                    </span>
                    {unread > 0 ? (
                      <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-md bg-slate-200 px-1.5 text-[11px] font-bold text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                        {unread > 99 ? "99+" : unread}
                      </span>
                    ) : hasLastMessage ? (
                      <span
                        className="inline-flex h-6 shrink-0 items-center text-sm font-semibold text-blue-500"
                        title="Up to date"
                        aria-hidden
                      >
                        ✓✓
                      </span>
                    ) : (
                      <span className="inline-block h-6 min-w-6 shrink-0" aria-hidden />
                    )}
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="border-t border-slate-200 p-3 dark:border-slate-700">
        <button
          className="w-full rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
          type="button"
          onClick={onLogout}
        >
          Logout
        </button>
      </div>
    </aside>
  );
}
