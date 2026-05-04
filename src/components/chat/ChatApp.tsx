"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { chatApi, deriveUsersFromChats, parseJwtIdentity } from "../../chat/api";
import type { Chat, ChatMessage, UserSummary } from "../../chat/types";
import ChatSidebar from "./ChatSidebar";
import ChatWindow from "./ChatWindow";
import { useChatRoomRealtime } from "./useChatRoomRealtime";

export default function ChatApp() {
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
    try {
      await chatApi.markRoomAsRead(token, activeRoomId);
    } catch {
      /* optional backend feature */
    }
  }, [token, activeRoomId]);

  const loadAppData = useCallback(async () => {
    if (!token) return;
    try {
      let meId: string | null = null;
      let meName: string | null = null;
      try {
        const me = await chatApi.getMe(token);
        meId = me.id;
        meName = me.username;
      } catch (err) {
        if (
          axios.isAxiosError(err) &&
          (err.response?.status === 401 || err.response?.status === 403)
        ) {
          handleApiError(err, "Failed to verify session.");
          return;
        }
        const jwt = parseJwtIdentity(token);
        meId = jwt.userId;
        meName = jwt.username;
      }
      setCurrentUserId(meId);
      setCurrentUsername(meName);

      const list = await chatApi.getChats(token);
      setChats(list);
      setActiveRoomId((prev) => {
        if (prev && list.some((chat) => chat.id === prev)) return prev;
        return list[0]?.id ?? "";
      });

      let userList: UserSummary[] = [];
      try {
        userList = await chatApi.getUsersList(token);
        userList = userList.filter((u) => {
          if (meId && u.id === meId) return false;
          if (meName && u.username === meName) return false;
          return true;
        });
      } catch {
        userList = [];
      }
      if (userList.length === 0) {
        userList = deriveUsersFromChats(list, meName, meId);
      }
      setUsers(userList);
    } catch (err) {
      handleApiError(err, "Failed to load chats.");
    }
  }, [token, handleApiError]);

  const refreshHistory = useCallback(async () => {
    if (!token || !activeRoomId) return;
    try {
      const history = await chatApi.getRoomHistory(token, activeRoomId);
      setMessages(history);
      setExtraUnreadByRoom((prev) => ({ ...prev, [activeRoomId]: 0 }));
    } catch (err) {
      handleApiError(err, "Failed to load messages.");
    }
  }, [token, activeRoomId, handleApiError]);

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
        }
        lastPreviewRef.current[chat.id] = newP;
      }
      return next;
    });
  }, [chats, activeRoomId]);

  const onStompRoomMessage = useCallback((msg: ChatMessage) => {
    setMessages((prev) => {
      if (prev.some((m) => m.id === msg.id)) return prev;
      return [...prev, msg];
    });
  }, []);

  const { sendTypingPing, typingUsers } = useChatRoomRealtime(
    token || null,
    activeRoomId || null,
    currentUsername,
    { onRoomMessage: onStompRoomMessage }
  );

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
    <div className="h-screen bg-slate-100 p-3">
      <div className="mx-auto flex h-full max-w-[1400px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <header className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="relative w-full max-w-md">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                🔎
              </span>
              <input
                className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none focus:border-blue-500"
                placeholder="Search anything ..."
              />
            </div>
            <button
              type="button"
              className="hidden rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 md:inline-flex"
            >
              Quick search
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-sm"
              title="Messages"
            >
              💬
            </button>
            <button
              type="button"
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-sm"
              title="Notifications"
            >
              🔔
            </button>
            <div className="ml-1 rounded-xl bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
              {currentUsername ?? "User"}
            </div>
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
                  prev.map((m) => (m.id === optimistic.id ? { ...sent, mine: true } : m))
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
                  prev.map((m) => (m.id === tempId ? { ...sent, mine: true } : m))
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
    </div>
  );
}
