"use client";

import {
  avatarTone,
  resolveChatAvatarUrl,
  resolveChatName,
  resolveOtherOnline,
} from "../../chat/chatPeerProfile";
import type { Chat, UserSummary } from "../../chat/types";
import { SafeRemoteImage } from "@/components/ui/SafeRemoteImage";

type ChatSidebarProps = {
  chats: Chat[];
  activeRoomId: string;
  /** Which main view is active (News Feed shortcut highlights when `feed`). */
  mainPane: "feed" | "friends" | "chat";
  currentUsername: string | null;
  users: UserSummary[];
  /** Extra unread bumps when last preview changes (non-active rooms). */
  extraUnreadByRoom: Record<string, number>;
  /** Filters chat list by room name and last message preview. */
  searchQuery?: string;
  onGoToFeed: () => void;
  onSelectRoom: (roomId: string) => void;
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
  mainPane,
  currentUsername,
  users,
  extraUnreadByRoom,
  searchQuery,
  onGoToFeed,
  onSelectRoom,
}: ChatSidebarProps) {
  const normalizedQuery = (searchQuery ?? "").trim().toLowerCase();
  const filteredChats =
    normalizedQuery.length === 0
      ? chats
      : chats.filter((chat) => {
          const title = resolveChatName(chat, currentUsername, users).toLowerCase();
          const preview = (chat.lastMessagePreview ?? "").toLowerCase();
          return title.includes(normalizedQuery) || preview.includes(normalizedQuery);
        });
  return (
    <aside className="flex h-full min-h-0 w-full shrink-0 flex-col overflow-hidden border-r border-[#e5e8e0] bg-white dark:border-slate-700 dark:bg-slate-900 md:w-[300px] lg:w-[320px]">
      <div className="shrink-0 space-y-2 border-b border-[#ebe8e2] p-4 dark:border-slate-700">
        <button
          type="button"
          onClick={onGoToFeed}
          className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition dark:border-slate-600 dark:text-slate-100 ${
            mainPane === "feed"
              ? "border-[#7d9b84]/55 bg-[#f0f4ee] text-slate-900 ring-1 ring-[#7d9b84]/30 dark:bg-slate-800/90"
              : "border-[#dfe6db] bg-white text-slate-800 hover:bg-[#f6f5f1] dark:bg-slate-800 dark:hover:bg-slate-700/80"
          }`}
        >
          <span aria-hidden>📰</span>
          News Feed
        </button>
        {/* <button
          type="button"
          onClick={onGoToFeed}
          className={`flex w-full items-start gap-3 rounded-2xl border p-3 text-left transition dark:border-slate-600 ${
            mainPane === "feed"
              ? "border-[#7d9b84]/55 bg-[#f0f4ee] ring-1 ring-[#7d9b84]/30 dark:bg-slate-800/90"
              : "border-[#e0e6df] bg-[#faf9f6] hover:bg-[#f3f2ed] dark:bg-slate-800/60 dark:hover:bg-slate-800"
          }`}
        >
          <span className="text-xl leading-none" aria-hidden>
            🏠
          </span>
          <span className="text-xl leading-none opacity-90" aria-hidden>
            💬
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-slate-900 dark:text-slate-100">Home Feed</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">Checkout your conversation.</p>
          </div>
        </button> */}
      </div>

      <div className="shrink-0 border-b border-slate-200 bg-[#f8f8f8] px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-800 dark:text-slate-100">
          My Friends
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto divide-y divide-slate-200 dark:divide-slate-700">
        {filteredChats.map((chat) => {
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
                mainPane === "chat" && activeRoomId === chat.id
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
                      <SafeRemoteImage
                        src={avatarUrl}
                        alt=""
                        className="h-full w-full object-cover"
                        variant="avatar"
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
        {filteredChats.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
            No chats match your search.
          </div>
        ) : null}
      </div>

    </aside>
  );
}
