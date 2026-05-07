"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { chatApi, deriveUsersFromChats, mergeUserSummaries, parseJwtIdentity } from "../../chat/api";
import {
  applyMessagesSeenEvent,
  isMessageFromCurrentUser,
  mergeRoomReadsIntoMessages,
} from "../../chat/messageReceipt";
import { applyDocumentLightDark } from "../../chat/profileTheme";
import { announceChatDebugOnce, isChatDebug } from "../../chat/chatDebug";
import { emitVoiceMessageSocket } from "../../chat/voiceSocketEmit";
import type { Chat, ChatMessage, MyUserProfile, UserSummary } from "../../chat/types";
import ChatSidebar from "./ChatSidebar";
import TopAlert from "./TopAlert";
import ChatWindow from "./ChatWindow";
import ProfileSettingsModal from "./ProfileSettingsModal";
import { useChatRoomRealtime } from "./useChatRoomRealtime";
import { useChatSeenReceipt } from "./useChatSeenReceipt";

function dedupeMessagesKeepFirst(items: ChatMessage[]): ChatMessage[] {
  const seen = new Set<string>();
  const out: ChatMessage[] = [];
  for (const m of items) {
    const k = String(m.id);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(m);
  }
  return out;
}

export default function ChatApp() {
  type GlobalAlertState = {
    id: string;
    roomId: string;
    senderName: string;
    preview: string;
    avatarUrl?: string | null;
  } | null;

  const [token, setToken] = useState("");
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUsername, setCurrentUsername] = useState<string | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [activeRoomId, setActiveRoomId] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [usernameInput, setUsernameInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [chatNotice, setChatNotice] = useState("");
  const [extraUnreadByRoom, setExtraUnreadByRoom] = useState<Record<string, number>>({});
  const lastPreviewRef = useRef<Record<string, string>>({});
  const chatsHydratedRef = useRef(false);
  const [chatDebugOn, setChatDebugOn] = useState(false);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [createGroupMemberIds, setCreateGroupMemberIds] = useState<string[]>([]);
  const [createGroupBusy, setCreateGroupBusy] = useState(false);
  const [createGroupLocalError, setCreateGroupLocalError] = useState("");
  const [showProfileSettings, setShowProfileSettings] = useState(false);
  const [profileAvatarUrl, setProfileAvatarUrl] = useState<string | null>(null);
  const [profileDisplayName, setProfileDisplayName] = useState<string | null>(null);
  const [topAlert, setTopAlert] = useState<GlobalAlertState>(null);

  useEffect(() => {
    const on = isChatDebug();
    setChatDebugOn(on);
    if (on) announceChatDebugOnce();
  }, []);

  const forceLogout = useCallback((message: string) => {
    window.localStorage.removeItem("accessToken");
    setToken("");
    setCurrentUserId(null);
    setCurrentUsername(null);
    setChats([]);
    setMessages([]);
    setUsers([]);
    setActiveRoomId("");
    setExtraUnreadByRoom({});
    lastPreviewRef.current = {};
    chatsHydratedRef.current = false;
    setChatNotice("");
    setStatusMessage(message);
    setProfileAvatarUrl(null);
    setProfileDisplayName(null);
  }, []);

  const handleApiError = useCallback(
    (err: unknown, fallbackMessage: string) => {
      if (axios.isAxiosError(err)) {
        const status = err.response?.status;
        if (status === 401 || status === 403) {
          forceLogout("Session expired or forbidden. Please login again.");
          return;
        }
      }
      if (token) setChatNotice(fallbackMessage);
      else setStatusMessage(fallbackMessage);
    },
    [forceLogout, token]
  );

  const activeChat = useMemo(
    () => chats.find((chat) => chat.id === activeRoomId) ?? null,
    [activeRoomId, chats]
  );

  const markRoomAsRead = useCallback(async () => {
    if (!token || !activeRoomId) return;
    let lastPersistedId: string | undefined;
    for (let i = messages.length - 1; i >= 0; i--) {
      const id = String(messages[i].id);
      if (!id.startsWith("temp-")) {
        lastPersistedId = id;
        break;
      }
    }
    try {
      await chatApi.markRoomAsRead(token, activeRoomId, lastPersistedId);
    } catch {
      /* optional backend feature */
    }
  }, [token, activeRoomId, messages]);

  const loadAppData = useCallback(async () => {
    if (!token) return;
    try {
      let meId: string | null = null;
      let meName: string | null = null;
      let headerAvatar: string | null = null;
      try {
        const prof = await chatApi.getMyProfile(token);
        meId = prof.id;
        meName = prof.username ?? prof.displayName;
        headerAvatar = prof.avatarUrl;
        setProfileDisplayName(prof.displayName ?? prof.username ?? null);
        applyDocumentLightDark(prof.theme);
      } catch (err) {
        if (
          axios.isAxiosError(err) &&
          (err.response?.status === 401 || err.response?.status === 403)
        ) {
          handleApiError(err, "Failed to verify session.");
          return;
        }
        try {
          const me = await chatApi.getMe(token);
          meId = me.id;
          meName = me.username;
          setProfileDisplayName(me.username);
          applyDocumentLightDark("light");
          headerAvatar = null;
        } catch (err2) {
          if (
            axios.isAxiosError(err2) &&
            (err2.response?.status === 401 || err2.response?.status === 403)
          ) {
            handleApiError(err2, "Failed to verify session.");
            return;
          }
          const jwt = parseJwtIdentity(token);
          meId = jwt.userId;
          meName = jwt.username;
          setProfileDisplayName(jwt.username);
          applyDocumentLightDark("light");
          headerAvatar = null;
        }
      }
      setCurrentUserId(meId);
      setCurrentUsername(meName);
      setProfileAvatarUrl(headerAvatar);

      const list = await chatApi.getChats(token);
      setChats(list);
      setActiveRoomId((prev) => {
        if (prev && list.some((chat) => chat.id === prev)) return prev;
        return list[0]?.id ?? "";
      });

      const ju = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
      let userList: UserSummary[] = [];
      try {
        userList = await chatApi.getUsersList(token);
      } catch {
        userList = [];
      }
      const fromChats = deriveUsersFromChats(list, meName, meId);
      userList = mergeUserSummaries(userList, fromChats);
      userList = userList.filter((u) => {
        if (meId != null && meId !== "" && u.id === meId) return false;
        if (meName != null && meName !== "" && ju(u.username) === ju(meName)) return false;
        if (meName != null && meName !== "" && u.displayName && ju(u.displayName) === ju(meName)) {
          return false;
        }
        return true;
      });
      setUsers(userList);
    } catch (err) {
      handleApiError(err, "Failed to load chats.");
    }
  }, [token, handleApiError]);

  const refreshHistory = useCallback(async () => {
    if (!token || !activeRoomId) return;
    try {
      const history = await chatApi.getRoomHistory(token, activeRoomId);
      let merged = history;
      try {
        const reads = await chatApi.getRoomReads(token, activeRoomId);
        merged = mergeRoomReadsIntoMessages(history, reads, currentUserId, currentUsername);
      } catch {
        /* optional: history DTO may already include seen/readAt */
      }
      setMessages(merged);
      setExtraUnreadByRoom((prev) => ({ ...prev, [activeRoomId]: 0 }));
    } catch (err) {
      handleApiError(err, "Failed to load messages.");
    }
  }, [token, activeRoomId, currentUserId, currentUsername, handleApiError]);

  const submitCreateGroup = useCallback(async () => {
    if (!token) return;
    const name = newGroupName.trim() || "New Group";
    if (createGroupMemberIds.length === 0) {
      setCreateGroupLocalError("Select at least one member.");
      return;
    }
    setCreateGroupLocalError("");
    setCreateGroupBusy(true);
    try {
      const roomId = await chatApi.createGroup(token, name, createGroupMemberIds);
      setShowCreateGroup(false);
      setNewGroupName("");
      setCreateGroupMemberIds([]);
      await loadAppData();
      if (roomId) setActiveRoomId(roomId);
      else setChatNotice("Group created, but the server did not return a room id.");
    } catch (err) {
      handleApiError(err, "Failed to create group.");
    } finally {
      setCreateGroupBusy(false);
    }
  }, [token, newGroupName, createGroupMemberIds, loadAppData, handleApiError]);

  const onProfileSavedFromModal = useCallback((p: MyUserProfile) => {
    setCurrentUserId(p.id);
    setCurrentUsername(p.username ?? p.displayName);
    setProfileDisplayName(p.displayName ?? p.username ?? null);
    setProfileAvatarUrl(p.avatarUrl);
    applyDocumentLightDark(p.theme);
  }, []);

  useEffect(() => {
    if (!token) {
      chatsHydratedRef.current = false;
      lastPreviewRef.current = {};
    }
  }, [token]);

  useEffect(() => {
    if (chats.length === 0) return;
    if (!chatsHydratedRef.current) {
      for (const c of chats) {
        lastPreviewRef.current[c.id] = c.lastMessagePreview ?? "";
      }
      chatsHydratedRef.current = true;
      return;
    }
    setExtraUnreadByRoom((prev) => {
      const next = { ...prev };
      for (const chat of chats) {
        if (chat.id === activeRoomId) {
          next[chat.id] = 0;
          lastPreviewRef.current[chat.id] = chat.lastMessagePreview ?? "";
          continue;
        }
        const prevP = lastPreviewRef.current[chat.id] ?? "";
        const newP = chat.lastMessagePreview ?? "";
        if (newP && newP !== prevP) {
          next[chat.id] = (next[chat.id] ?? 0) + 1;
          const resolveChatLabelAndAvatar = (): { label: string; avatarUrl?: string | null } => {
            if (chat.isGroup) {
              return { label: chat.groupName?.trim() || "Group", avatarUrl: chat.avatarUrl ?? null };
            }
            const other =
              (chat.members ?? []).find((m) => {
                if (!m.username && !m.name && !m.id) return false;
                if (currentUserId && m.id && String(m.id) === String(currentUserId)) return false;
                const uname = (m.username ?? m.name ?? "").trim().toLowerCase();
                if (
                  currentUsername &&
                  uname &&
                  uname === String(currentUsername).trim().toLowerCase()
                ) {
                  return false;
                }
                return true;
              }) ?? null;
            const otherUsername = (other?.username ?? other?.name ?? chat.directName ?? "").trim();
            const userMatch =
              users.find(
                (u) =>
                  (other?.id != null && String(u.id) === String(other.id)) ||
                  (otherUsername && String(u.username).toLowerCase() === otherUsername.toLowerCase())
              ) ?? null;
            return {
              label: userMatch?.displayName?.trim() || otherUsername || "New message",
              avatarUrl: userMatch?.avatarUrl ?? chat.avatarUrl ?? null,
            };
          };
          const { label, avatarUrl } = resolveChatLabelAndAvatar();
          setTopAlert({
            id: `${chat.id}:preview:${Date.now()}`,
            roomId: chat.id,
            senderName: label,
            preview: newP,
            avatarUrl,
          });
        }
        lastPreviewRef.current[chat.id] = newP;
      }
      return next;
    });
  }, [chats, activeRoomId, currentUserId, currentUsername, users]);

  const onStompRoomMessage = useCallback(
    (msg: ChatMessage) => {
      const roomId = String(msg.roomId ?? "");
      const mine = isMessageFromCurrentUser(msg, currentUserId, currentUsername);
      const roomIsActive = roomId !== "" && roomId === activeRoomId;
      if (!mine && !roomIsActive) {
        const senderName = msg.sender?.trim() || "New message";
        const userMatch =
          users.find(
            (u) =>
              (msg.senderId != null && String(u.id) === String(msg.senderId)) ||
              String(u.username).toLowerCase() === senderName.toLowerCase()
          ) ?? null;
        const previewText =
          msg.mediaType === "voice"
            ? "Sent a voice message"
            : msg.mediaType === "image"
              ? "Sent an image"
              : msg.mediaType === "file"
                ? "Sent a file"
                : (msg.content || "").trim() || "New message";
        setTopAlert({
          id: `${roomId}:${String(msg.id)}:${Date.now()}`,
          roomId,
          senderName: userMatch?.displayName?.trim() || senderName,
          preview: previewText,
          avatarUrl: userMatch?.avatarUrl ?? null,
        });
      }

      setMessages((prev) => {
        const idKey = String(msg.id);
        if (prev.some((m) => String(m.id) === idKey)) return prev;

        const fromMe = isMessageFromCurrentUser(msg, currentUserId, currentUsername);
        let next = prev;
        if (fromMe) {
          next = prev.filter((m) => {
            if (!m.pending || !m.mine || m.roomId !== msg.roomId) return true;
            if (m.content && msg.content && m.content === msg.content) return false;
            if (String(m.id).startsWith("temp-media-") && (msg.mediaUrl || msg.mediaType)) return false;
            if (String(m.id).startsWith("temp-voice-") && msg.mediaType === "voice") return false;
            return true;
          });
        }

        const isMine =
          Boolean(currentUserId && msg.senderId != null && String(msg.senderId) === String(currentUserId)) ||
          Boolean(currentUsername && msg.sender === currentUsername);
        return dedupeMessagesKeepFirst([...next, { ...msg, mine: isMine || msg.mine }]);
      });
    },
    [activeRoomId, currentUserId, currentUsername, users]
  );

  const { sendTypingPing, typingUsers } = useChatRoomRealtime(
    token || null,
    activeRoomId || null,
    currentUsername,
    { onRoomMessage: onStompRoomMessage }
  );

  const onMessagesSeen = useCallback(
    (payload: unknown) => {
      setMessages((prev) =>
        applyMessagesSeenEvent(prev, activeRoomId, payload, currentUserId, currentUsername)
      );
    },
    [activeRoomId, currentUserId, currentUsername]
  );

  useChatSeenReceipt(token || null, activeRoomId || null, currentUserId, onMessagesSeen);

  useEffect(() => {
    const saved = window.localStorage.getItem("accessToken") ?? "";
    if (!saved) return;
    setToken(saved);
  }, []);

  useEffect(() => {
    if (!token) return;
    void loadAppData();
  }, [token, loadAppData]);

  useEffect(() => {
    if (!token || !activeRoomId) return;
    void refreshHistory();
  }, [token, activeRoomId, refreshHistory]);

  useEffect(() => {
    if (!token) return;
    const onVisible = (): void => {
      if (document.visibilityState !== "visible") return;
      void loadAppData();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [token, loadAppData]);

  useEffect(() => {
    if (!token || !activeRoomId) return;
    const onVisible = (): void => {
      if (document.visibilityState !== "visible") return;
      void refreshHistory();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [token, activeRoomId, refreshHistory]);

  const handleAuth = async () => {
    try {
      if (authMode === "register") {
        await chatApi.register(usernameInput.trim(), passwordInput.trim());
        setAuthMode("login");
        setStatusMessage("Registered. Please login.");
        return;
      }
      const auth = await chatApi.login(usernameInput.trim(), passwordInput.trim());
      if (!auth.token) {
        setStatusMessage("Login failed: missing token.");
        return;
      }
      window.localStorage.setItem("accessToken", auth.token);
      setToken(auth.token);
      setCurrentUserId(auth.currentUserId);
      setCurrentUsername(auth.currentUsername);
      setStatusMessage("");
      setUsernameInput("");
      setPasswordInput("");
      await loadAppData();
    } catch {
      setStatusMessage("Authentication failed.");
    }
  };

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
        <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow">
          <h1 className="text-xl font-semibold">
            {authMode === "login" ? "Login" : "Register"}
          </h1>
          <div className="mt-4 space-y-3">
            <input
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
              placeholder="Username"
              value={usernameInput}
              onChange={(e) => setUsernameInput(e.target.value)}
            />
            <input
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
              type="password"
              placeholder="Password"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
            />
            {statusMessage && <p className="text-sm text-red-600">{statusMessage}</p>}
            <button
              className="w-full rounded-lg bg-blue-600 px-3 py-2 text-white hover:bg-blue-700"
              type="button"
              onClick={() => void handleAuth()}
            >
              {authMode === "login" ? "Login" : "Create account"}
            </button>
            <button
              className="w-full text-sm text-slate-600 underline"
              type="button"
              onClick={() =>
                setAuthMode((prev) => (prev === "login" ? "register" : "login"))
              }
            >
              {authMode === "login" ? "Need an account? Register" : "Already have an account?"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-slate-100 p-3 dark:bg-slate-950">
      <TopAlert
        key={topAlert?.id ?? "top-alert-empty"}
        open={Boolean(topAlert)}
        senderName={topAlert?.senderName ?? ""}
        preview={topAlert?.preview ?? ""}
        avatarUrl={topAlert?.avatarUrl}
        onClose={() => setTopAlert(null)}
        onClick={() => {
          if (!topAlert?.roomId) return;
          setExtraUnreadByRoom((p) => ({ ...p, [topAlert.roomId]: 0 }));
          setActiveRoomId(topAlert.roomId);
          setTopAlert(null);
        }}
      />
      <div className="mx-auto flex h-full max-w-[1400px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <header className="relative flex items-center justify-between gap-4 border-b border-slate-200 bg-white px-5 py-3 dark:border-slate-700 dark:bg-slate-900/80">
          {chatDebugOn ? (
            <div className="absolute left-1/2 top-2 z-50 -translate-x-1/2 rounded-full border border-amber-400 bg-amber-100 px-3 py-1 text-[10px] font-semibold text-amber-950 shadow dark:border-amber-500 dark:bg-amber-950/90 dark:text-amber-100">
              CHAT_DEBUG — see DevTools console + voice bubble panels
            </div>
          ) : null}
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="relative w-full max-w-md">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                🔎
              </span>
              <input
                className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm text-slate-900 outline-none focus:border-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
                placeholder="Search anything ..."
              />
            </div>
            <button
              type="button"
              className="hidden rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800 md:inline-flex"
            >
              Quick search
            </button>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/me/posts"
              className="inline-flex shrink-0 rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 sm:px-3"
            >
              <span className="sm:hidden">Posts</span>
              <span className="hidden sm:inline">My posts</span>
            </Link>
            <button
              type="button"
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-sm dark:border-slate-600 dark:bg-slate-800"
              title="Messages"
            >
              💬
            </button>
            <button
              type="button"
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-sm dark:border-slate-600 dark:bg-slate-800"
              title="Notifications"
            >
              🔔
            </button>
            <button
              type="button"
              className="ml-1 flex max-w-[220px] items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-2 py-1.5 text-left text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              title="Profile and settings"
              onClick={() => setShowProfileSettings(true)}
            >
              {profileAvatarUrl ? (
                <img
                  src={profileAvatarUrl}
                  alt=""
                  className="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-slate-200 dark:ring-slate-600"
                  loading="eager"
                  decoding="async"
                />
              ) : (
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-blue-500 to-blue-700 text-xs font-bold text-white">
                  {(profileDisplayName ?? currentUsername ?? "?").slice(0, 1).toUpperCase()}
                </span>
              )}
              <span className="min-w-0 truncate">{profileDisplayName ?? currentUsername ?? "User"}</span>
              <span className="shrink-0 text-slate-400" aria-hidden>
                ▾
              </span>
            </button>
          </div>
        </header>
        <div className="flex min-h-0 flex-1">
        <ChatSidebar
          chats={chats}
          activeRoomId={activeRoomId}
          currentUsername={currentUsername}
          users={users}
          extraUnreadByRoom={extraUnreadByRoom}
          onSelectRoom={(id) => {
            setExtraUnreadByRoom((p) => ({ ...p, [id]: 0 }));
            setActiveRoomId(id);
          }}
          onStartPrivateChat={async (userId) => {
            try {
              const roomId = await chatApi.startPrivateChat(token, userId);
              await loadAppData();
              if (roomId) setActiveRoomId(roomId);
            } catch (err) {
              handleApiError(err, "Failed to start private chat.");
            }
          }}
          onCreateGroup={() => {
            setCreateGroupLocalError("");
            setNewGroupName("");
            setCreateGroupMemberIds([]);
            setShowCreateGroup(true);
          }}
          onLogout={() => {
            forceLogout("");
          }}
        />

        <ChatWindow
          activeChat={activeChat}
          messages={messages}
          users={users}
          currentUserId={currentUserId}
          currentUsername={currentUsername}
          typingUsers={typingUsers}
          onTypingActivity={() => sendTypingPing()}
          notice={chatNotice}
          onDismissNotice={() => setChatNotice("")}
          onMarkRead={markRoomAsRead}
          onSend={async (content) => {
            if (!activeRoomId) return;
            const optimistic: ChatMessage = {
              id: `temp-${Date.now()}`,
              roomId: activeRoomId,
              sender: currentUsername ?? "You",
              senderId: currentUserId ?? undefined,
              content,
              createdAt: new Date().toISOString(),
              mine: true,
              pending: true,
            };
            setMessages((prev) => [...prev, optimistic]);
            try {
              const sent = await chatApi.sendMessage(token, activeRoomId, content);
              if (sent) {
                setMessages((prev) =>
                  dedupeMessagesKeepFirst(
                    prev.map((m) => (m.id === optimistic.id ? { ...sent, mine: true } : m))
                  )
                );
              } else {
                await refreshHistory();
              }
              await loadAppData();
            } catch (err) {
              setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
              handleApiError(err, "Failed to send message.");
            }
          }}
          onEdit={async (messageId, content) => {
            if (!content.trim()) return;
            try {
              await chatApi.editMessage(token, messageId, content);
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === messageId
                    ? { ...m, content, editedAt: new Date().toISOString() }
                    : m
                )
              );
            } catch (err) {
              handleApiError(err, "Failed to edit message.");
            }
          }}
          onDelete={async (messageId) => {
            try {
              await chatApi.deleteMessage(token, messageId);
              setMessages((prev) => prev.filter((m) => m.id !== messageId));
            } catch (err) {
              handleApiError(err, "Failed to delete message.");
            }
          }}
          onReact={async (messageId, emoji) => {
            const prevMessages = messages;
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id !== messageId) return m;
                const nextMap = { ...(m.reactions ?? {}) };
                const prevMine = m.myReaction;
                if (prevMine) {
                  nextMap[prevMine] = Math.max(0, (nextMap[prevMine] ?? 1) - 1);
                  if (nextMap[prevMine] === 0) delete nextMap[prevMine];
                }
                nextMap[emoji] = (nextMap[emoji] ?? 0) + (prevMine === emoji ? 0 : 1);
                return { ...m, reactions: nextMap, myReaction: emoji };
              })
            );
            try {
              await chatApi.reactToMessage(token, messageId, emoji);
            } catch (err) {
              setMessages(prevMessages);
              handleApiError(err, "Failed to react to message.");
            }
          }}
          onSendVoice={async (blob, durationSec) => {
            if (!activeRoomId) return;
            const tempId = `temp-voice-${Date.now()}`;
            const localUrl = URL.createObjectURL(blob);
            const optimistic: ChatMessage = {
              id: tempId,
              roomId: activeRoomId,
              sender: currentUsername ?? "You",
              senderId: currentUserId ?? undefined,
              content: "",
              createdAt: new Date().toISOString(),
              mine: true,
              pending: true,
              mediaUrl: localUrl,
              mediaType: "voice",
              voiceDurationSec: durationSec,
              voiceDeliveryPhase: "uploading",
            };
            setMessages((prev) => [...prev, optimistic]);
            try {
              const remoteUrl = await chatApi.uploadVoiceBlobWithFetch(token, blob);
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === tempId ? { ...m, voiceDeliveryPhase: "sending" as const } : m
                )
              );
              emitVoiceMessageSocket({
                type: "voice",
                audioUrl: remoteUrl,
                roomId: activeRoomId,
                durationSec,
              });
              const sent = await chatApi.sendVoiceMessage(
                token,
                activeRoomId,
                remoteUrl,
                durationSec
              );
              if (sent) {
                setMessages((prev) =>
                  dedupeMessagesKeepFirst(
                    prev.map((m) => (m.id === tempId ? { ...sent, mine: true } : m))
                  )
                );
              } else {
                setMessages((prev) => prev.filter((m) => m.id !== tempId));
                await refreshHistory();
              }
              await loadAppData();
            } catch (err) {
              setMessages((prev) => prev.filter((m) => m.id !== tempId));
              handleApiError(err, "Failed to send voice message.");
            } finally {
              URL.revokeObjectURL(localUrl);
            }
          }}
          onSendMedia={async (file) => {
            if (!activeRoomId) return;
            const tempId = `temp-media-${Date.now()}`;
            const localUrl = URL.createObjectURL(file);
            const optimistic: ChatMessage = {
              id: tempId,
              roomId: activeRoomId,
              sender: currentUsername ?? "You",
              senderId: currentUserId ?? undefined,
              content: "",
              createdAt: new Date().toISOString(),
              mine: true,
              pending: true,
              mediaUrl: localUrl,
              mediaType: file.type.startsWith("image/") ? "image" : "file",
            };
            setMessages((prev) => [...prev, optimistic]);
            try {
              const sent = await chatApi.sendMediaMessage(token, activeRoomId, file);
              if (sent) {
                setMessages((prev) =>
                  dedupeMessagesKeepFirst(
                    prev.map((m) => (m.id === tempId ? { ...sent, mine: true } : m))
                  )
                );
              } else {
                setMessages((prev) => prev.filter((m) => m.id !== tempId));
                await refreshHistory();
              }
              await loadAppData();
            } catch (err) {
              setMessages((prev) => prev.filter((m) => m.id !== tempId));
              handleApiError(err, "Failed to send media.");
            } finally {
              URL.revokeObjectURL(localUrl);
            }
          }}
          onInvite={async (userId) => {
            if (!activeRoomId) return;
            try {
              await chatApi.inviteUserToGroup(token, activeRoomId, userId);
              setChatNotice("");
              await loadAppData();
            } catch (err) {
              handleApiError(err, "Failed to invite user.");
            }
          }}
          onRemoveMember={async (userId) => {
            if (!activeRoomId) return;
            try {
              await chatApi.removeGroupMember(token, activeRoomId, userId);
              setChatNotice("");
              await loadAppData();
            } catch (err) {
              if (axios.isAxiosError(err) && err.response?.status === 404) {
                setChatNotice(
                  "Remove-member endpoint not found (404). Set the correct URL in `chatApi.removeGroupMember`."
                );
              } else {
                handleApiError(err, "Failed to remove member.");
              }
            }
          }}
        />
        </div>
      </div>

      {showCreateGroup ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
          <div
            className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-group-title"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 id="create-group-title" className="text-lg font-semibold text-slate-900">
                  New group
                </h3>
                <p className="mt-1 text-sm text-slate-600">Name the group and pick at least one member.</p>
              </div>
              <button
                type="button"
                className="rounded-full bg-slate-200 px-2 py-1 text-xs text-slate-700 hover:bg-slate-300"
                onClick={() => setShowCreateGroup(false)}
              >
                X
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <input
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-blue-500"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="Group name"
                autoFocus
              />

              <div className="max-h-60 overflow-y-auto rounded-xl border border-slate-100 bg-slate-50 p-3">
                {users.length === 0 ? (
                  <p className="text-sm text-slate-600">No users available. Open a direct chat first or check /api/users.</p>
                ) : (
                  <div className="space-y-2">
                    {users.map((u) => {
                      const checked = createGroupMemberIds.includes(u.id);
                      return (
                        <label
                          key={u.id}
                          className="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2 py-2 hover:bg-white"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-slate-900">{u.username}</div>
                            <div className="text-xs text-slate-500">{u.online ? "Online" : "Offline"}</div>
                          </div>
                          <input
                            type="checkbox"
                            checked={checked}
                            className="h-4 w-4 rounded border-slate-300"
                            onChange={(e) => {
                              setCreateGroupMemberIds((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(u.id);
                                else next.delete(u.id);
                                return Array.from(next);
                              });
                            }}
                          />
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              {createGroupLocalError ? <p className="text-sm text-red-600">{createGroupLocalError}</p> : null}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  className="rounded-xl bg-slate-200 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-300"
                  onClick={() => setShowCreateGroup(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-blue-300"
                  disabled={createGroupBusy || users.length === 0}
                  onClick={() => void submitCreateGroup()}
                >
                  {createGroupBusy ? "Creating…" : "Create"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <ProfileSettingsModal
        open={showProfileSettings}
        token={token}
        onClose={() => setShowProfileSettings(false)}
        onSaved={(p) => {
          onProfileSavedFromModal(p);
          void loadAppData();
        }}
      />
    </div>
  );
}
