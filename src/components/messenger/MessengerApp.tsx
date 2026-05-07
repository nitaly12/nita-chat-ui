"use client";

import { Client, IMessage } from "@stomp/stompjs";
import axios from "axios";
import SockJS from "sockjs-client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Chat, ChatMember, ChatMessage } from "@/chat/types";
import { backendApi, webApi } from "@/chat/api";
import {
  decodeJwtSub,
  extractMessageList,
  extractTokenFromLoginResponse,
  formatTime,
  parseMemberIdsForApi,
  toChat,
  toMessage,
} from "../../chat/mappers";
import { loadUsersForPicker } from "../../chat/loadUsers";

export default function MessengerApp() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string>("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [accessToken, setAccessToken] = useState<string>("");
  const [status, setStatus] = useState("Logged out");
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sendMessage, setSendMessage] = useState("");
  const [mounted, setMounted] = useState(false);
  const [allUsers, setAllUsers] = useState<ChatMember[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string>("");
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [createGroupSelectedUserIds, setCreateGroupSelectedUserIds] = useState<
    string[]
  >([]);
  const [showInviteMember, setShowInviteMember] = useState(false);
  const [inviteUserId, setInviteUserId] = useState<string>("");
  const [modalMessage, setModalMessage] = useState<string>("");
  const [directTitlesByRoom, setDirectTitlesByRoom] = useState<Record<string, string>>({});

  const stompClientRef = useRef<Client | null>(null);
  const messageListEndRef = useRef<HTMLDivElement | null>(null);

  const currentSub = useMemo(() => (accessToken ? decodeJwtSub(accessToken) : null), [accessToken]);

  const activeChat = useMemo(
    () => chats.find((chat) => chat.id === activeRoomId) ?? null,
    [activeRoomId, chats]
  );
  const resolveDirectChatTitle = useCallback(
    (chat: Chat | null): string => {
      if (!chat || chat.isGroup) return "Select a conversation";

      const otherMember =
        (chat.members ?? []).find((m) => {
          if (!m.username) return false;
          if (!currentSub) return true;
          return m.username !== currentSub;
        }) ?? null;
      if (otherMember?.username) return otherMember.username;

      const fromHistory = directTitlesByRoom[chat.id]?.trim();
      if (fromHistory && (!currentSub || fromHistory !== currentSub)) return fromHistory;

      const directName = chat.directName?.trim();
      if (directName && (!currentSub || directName !== currentSub)) return directName;

      const groupName = chat.groupName?.trim();
      if (groupName && (!currentSub || groupName !== currentSub)) return groupName;

      return `Chat #${chat.id}`;
    },
    [currentSub, directTitlesByRoom]
  );

  const pickOtherUsernameFromMessages = useCallback(
    (roomId: string, list: ChatMessage[]): void => {
      const other = list
        .map((m) => m.sender?.trim())
        .find((name) => Boolean(name) && (!currentSub || name !== currentSub));
      if (!other) return;
      setDirectTitlesByRoom((prev) => {
        if (prev[roomId] === other) return prev;
        return { ...prev, [roomId]: other };
      });
    },
    [currentSub]
  );

  useEffect(() => {
    void (async () => {
      const savedToken = window.localStorage.getItem("accessToken") ?? "";
      setAccessToken(savedToken);
      setStatus(savedToken ? "Connecting..." : "Logged out");
      setMounted(true);
    })();
  }, []);

  const loadAllUsers = async (): Promise<ChatMember[]> => {
    if (!accessToken) return [];
    setUsersError("");
    setUsersLoading(true);
    try {
      const { users, error } = await loadUsersForPicker(
        backendApi,
        accessToken,
        chats,
        currentSub
      );
      setAllUsers(users);
      setUsersError(error);
      return users;
    } finally {
      setUsersLoading(false);
    }
  };

  const reloadChats = useCallback(
    async (preferredRoomId?: string): Promise<void> => {
      if (!accessToken) return;
      try {
        const response = await backendApi.get("/api/chats", {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });

        const raw = response.data as unknown;
        let list: unknown[] = [];
        if (Array.isArray(raw)) {
          list = raw;
        } else if (raw && typeof raw === "object") {
          const record = raw as Record<string, unknown>;
          const candidate =
            record.chats ?? record.conversations ?? record.rooms ?? record.data;
          list = Array.isArray(candidate) ? candidate : [];
        }

        const incomingChats = list.map(toChat).filter((chat) => chat.id.length > 0);
        setChats(incomingChats);

        const nextPreferred =
          preferredRoomId && incomingChats.some((c) => c.id === preferredRoomId)
            ? preferredRoomId
            : incomingChats.length > 0
              ? incomingChats[0].id
              : "";

        if (nextPreferred) setActiveRoomId(nextPreferred);
      } catch (err) {
        if (axios.isAxiosError(err) && err.response?.status === 401) {
          window.localStorage.removeItem("accessToken");
          setAccessToken("");
          setStatus("Logged out");
          setAuthMessage("Session expired. Please login again.");
          setChats([]);
          setActiveRoomId("");
          setMessages([]);
          return;
        }
        setChats([]);
        setActiveRoomId("");
      }
    },
    [accessToken]
  );

  const handleOpenCreateGroup = (): void => {
    setModalMessage("");
    setNewGroupName("");
    setCreateGroupSelectedUserIds([]);
    setShowCreateGroup(true);
    if (allUsers.length === 0 && !usersLoading) {
      void loadAllUsers();
    }
  };

  const handleOpenInvite = (): void => {
    setModalMessage("");
    setInviteUserId("");
    setShowInviteMember(true);
    if (allUsers.length === 0 && !usersLoading) {
      void loadAllUsers();
    }
  };

  const handleCreateGroup = async (): Promise<void> => {
    if (!accessToken) return;
    const name = newGroupName.trim() || "New Group";
    const selected = createGroupSelectedUserIds;
    if (selected.length === 0) {
      setModalMessage("Select at least one member.");
      return;
    }

    setModalMessage("");
    try {
      const memberIds = parseMemberIdsForApi(selected);
      const response = await backendApi.post(
        "/api/chats/group",
        {
          name,
          memberIds,
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      const data = response.data as Record<string, unknown>;
      const roomObj = data.room as Record<string, unknown> | undefined;
      const chatObj = data.chat as Record<string, unknown> | undefined;
      const createdRoomId =
        data.roomId ??
        data.id ??
        data.chatRoomId ??
        roomObj?.id ??
        chatObj?.id ??
        "";
      const newRoomId = String(createdRoomId);
      if (!newRoomId) {
        setModalMessage(
          "Group created, but roomId was not returned. Check backend response."
        );
        await reloadChats();
        return;
      }

      setShowCreateGroup(false);
      setActiveRoomId(newRoomId);
      setMessages([]);
      await reloadChats(newRoomId);
    } catch {
      setModalMessage("Failed to create group.");
    }
  };

  const handleInviteMember = async (): Promise<void> => {
    if (!accessToken) return;
    if (!inviteUserId) {
      setModalMessage("Select a user to invite.");
      return;
    }
    if (!activeRoomId) return;

    setModalMessage("");
    try {
      await backendApi.post(
        `/api/chats/${activeRoomId}/invite/${inviteUserId}`,
        {},
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      setShowInviteMember(false);
      await reloadChats(activeRoomId);
    } catch {
      setModalMessage("Failed to invite member.");
    }
  };

  useEffect(() => {
    if (!accessToken) return;
    void (async () => {
      await reloadChats();
    })();
  }, [accessToken, reloadChats]);

  useEffect(() => {
    // STATELESS API: never call protected history without a JWT (avoids 403 / anonymous).
    if (!activeRoomId || !accessToken) {
      return;
    }
    console.log("activeRoomId:", activeRoomId);
    console.log("accessToken:", accessToken);
    const fetchHistory = async (): Promise<void> => {
      try {
        const response = await backendApi.get(
          `/api/rooms/${activeRoomId}/history`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          }
        );
        const historyList = extractMessageList(response.data);
        console.log("historyList (after fetch):", {
          roomId: activeRoomId,
          count: historyList.length,
        });
        const mapped = historyList.map(toMessage);
        setMessages(mapped);
        pickOtherUsernameFromMessages(activeRoomId, mapped);
      } catch {
        setMessages([]);
      }
    };

    void fetchHistory();
  }, [activeRoomId, accessToken, pickOtherUsernameFromMessages]);

  useEffect(() => {
    if (!accessToken || !activeRoomId) {
      return;
    }

    stompClientRef.current?.deactivate();

    const client = new Client({
      webSocketFactory: () => new SockJS("http://localhost:8080/ws-chat"),
      connectHeaders: {
        Authorization: `Bearer ${accessToken}`,
        accessToken,
      },
      reconnectDelay: 5000,
      debug: (str) => {
        console.log("STOMP:", str);
      },
      onConnect: () => {
        setStatus("Connected");
        client.subscribe(`/topic/room/${activeRoomId}`, (frame: IMessage) => {
          console.log("STOMP topic message received:", frame.body);
          const incoming = toMessage(JSON.parse(frame.body) as unknown);
          setMessages((prev) => [...prev, incoming]);
          pickOtherUsernameFromMessages(activeRoomId, [incoming]);
        });
      },
      onWebSocketError: (event) => {
        console.error("WebSocket error:", event);
      },
      onStompError: (frame) => {
        setStatus("Broker error");
        // Helpful when backend rejects/silently ignores publishes.
        console.error("STOMP error:", frame?.headers, frame?.body);
      },
      onUnhandledReceipt: (frame) => {
        console.warn("Unhandled receipt:", frame?.headers, frame?.body);
      },
      onWebSocketClose: () => {
        setStatus("Disconnected");
      },
    });

    client.activate();
    stompClientRef.current = client;

    return () => {
      void client.deactivate();
    };
  }, [activeRoomId, accessToken, pickOtherUsernameFromMessages]);

  useEffect(() => {
    messageListEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = (): void => {
    const trimmed = draft.trim();
    if (!trimmed) {
      return;
    }
    console.log("handleSend() pressed Enter:", {
      roomId: activeRoomId,
      connected: Boolean(stompClientRef.current?.connected),
    });
    if (!activeRoomId) {
      setSendMessage("Select a room first.");
      return;
    }
    if (!stompClientRef.current?.connected) {
      console.warn("STOMP not connected; refusing to publish.");
      setSendMessage("WebSocket not connected yet.");
      return;
    }
    const receiptId = `r-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setSendMessage("Sending...");

    // Send a tolerant payload (most backends use one of these field names).
    // Keep payload minimal to match typical MessageRequest DTOs.
    // The roomId is inferred from the STOMP destination path.
    const payload = {
      content: trimmed,
      message: trimmed,
    };

    const client = stompClientRef.current;
    // Register receipt watcher before publish to avoid missing fast responses.
    client.watchForReceipt(receiptId, (frame) => {
      console.log("STOMP receipt received:", receiptId, frame?.command, frame?.headers);
      setSendMessage("");
    });

    console.log(
      "Publishing STOMP message to:",
      `/app/chat.send/${activeRoomId}`,
      payload
    );

    client.publish({
      // Must match backend @MessageMapping("/chat.send/{roomId}") with app prefix.
      destination: `/app/chat.send/${activeRoomId}`,
      body: JSON.stringify(payload),
      headers: accessToken
        ? {
            Authorization: `Bearer ${accessToken}`,
            accessToken,
            receipt: receiptId,
          }
        : undefined,
    });

    // Fallback: if persistence succeeded but topic broadcast failed,
    // history refresh will still show the message.
    void (async () => {
      try {
        let historyList: unknown[] = [];
        try {
          const historyResp = await backendApi.get<unknown>(
            `/api/chats/${activeRoomId}/history`,
            {
              headers: accessToken
                ? {
                    Authorization: `Bearer ${accessToken}`,
                  }
                : undefined,
            }
          );
          historyList = extractMessageList(historyResp.data);
        } catch {
          const historyResp = await backendApi.get<unknown>(
            `/api/rooms/${activeRoomId}/history`,
            {
              headers: accessToken
                ? {
                    Authorization: `Bearer ${accessToken}`,
                  }
                : undefined,
            }
          );
          historyList = extractMessageList(historyResp.data);
        }
        console.log("historyList (after send):", {
          roomId: activeRoomId,
          count: historyList.length,
        });
        if (historyList.length > 0) {
          const mapped = historyList.map(toMessage);
          setMessages(mapped);
          pickOtherUsernameFromMessages(activeRoomId, mapped);
        }
      } catch {
        // ignore; topic/subscription will still update if working
      }
    })();

    setDraft("");
  };

  const handleAuth = async (): Promise<void> => {
    if (!username.trim() || !password.trim()) {
      setAuthMessage("Username and password are required.");
      return;
    }

    setIsSubmitting(true);
    setAuthMessage("");

    try {
      if (authMode === "register") {
        await webApi.post("/api/auth/register", {
          username: username.trim(),
          password: password.trim(),
        });
        setAuthMessage("Register success. Please login.");
        setAuthMode("login");
        return;
      }

      const response = await webApi.post("/api/auth/login", {
        username: username.trim(),
        password: password.trim(),
      });

      // Extract JWT from common response shapes:
      // - { accessToken: "..." }
      // - { token: "..." } / { jwt: "..." }
      // - raw string response
      // - Authorization header: "Bearer <jwt>"
      const token = extractTokenFromLoginResponse(
        response.data,
        (response.headers ?? {}) as Record<string, unknown>
      );
      if (!token) {
        // Safe debug: show only keys and avoid leaking the token.
        const record =
          response.data && typeof response.data === "object"
            ? (response.data as Record<string, unknown>)
            : null;
        const safeResponse = record
          ? Object.fromEntries(
              Object.entries(record).map(([k, v]) => [
                k,
                k.toLowerCase().includes("token") ? "[redacted]" : v,
              ])
            )
          : response.data;
        console.debug("Login response (redacted):", safeResponse);
        const keys = record ? Object.keys(record).join(", ") : typeof response.data;
        setAuthMessage(`No token extracted. Login response keys: ${keys}. Check console.`);
        return;
      }
      setAccessToken(String(token));
      window.localStorage.setItem("accessToken", String(token));
      setStatus("Connected");
      setAuthMessage("");
    } catch {
      setAuthMessage(authMode === "register" ? "Register failed." : "Login failed.");
      setStatus("Authentication failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLogout = (): void => {
    void stompClientRef.current?.deactivate();
    setAccessToken("");
    setChats([]);
    setActiveRoomId("");
    setMessages([]);
    setStatus("Logged out");
    setDraft("");
    window.localStorage.removeItem("accessToken");
  };

  if (!mounted) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-100 p-4 text-slate-900">
        Loading...
      </div>
    );
  }

  if (!accessToken) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-100 p-4 text-slate-900">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-lg">
          <h1 className="text-xl font-bold">Messenger Platform</h1>
          <p className="mt-1 text-sm text-slate-500">Sign in or create a new account</p>

          <div className="mt-5 grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
            <button
              className={`rounded-lg px-3 py-2 text-sm font-medium ${
                authMode === "login" ? "bg-white shadow" : "text-slate-600"
              }`}
              onClick={() => setAuthMode("login")}
              type="button"
            >
              Login
            </button>
            <button
              className={`rounded-lg px-3 py-2 text-sm font-medium ${
                authMode === "register" ? "bg-white shadow" : "text-slate-600"
              }`}
              onClick={() => setAuthMode("register")}
              type="button"
            >
              Register
            </button>
          </div>

          <div className="mt-4 space-y-3">
            <input
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-blue-500"
              onChange={(event) => setUsername(event.target.value)}
              placeholder="Username"
              value={username}
            />
            <input
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-blue-500"
              onChange={(event) => setPassword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleAuth();
                }
              }}
              placeholder="Password"
              type="password"
              value={password}
            />
            {authMessage && <p className="text-sm text-slate-600">{authMessage}</p>}
            <button
              className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
              disabled={isSubmitting}
              onClick={() => void handleAuth()}
              type="button"
            >
              {isSubmitting ? "Please wait..." : authMode === "login" ? "Login" : "Register"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-slate-100 p-4 text-slate-900">
      <div className="mx-auto flex h-full max-w-6xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg">
        <aside className="w-72 border-r border-slate-200 bg-slate-50">
          <div className="border-b border-slate-200 p-4">
            <h1 className="text-lg font-bold">Messenger Platform</h1>
            <p className="mt-1 text-xs text-slate-500">WebSocket: {status}</p>
            <button
              className="mt-2 rounded-md bg-slate-200 px-2 py-1 text-xs text-slate-700 hover:bg-slate-300"
              onClick={handleLogout}
              type="button"
            >
              Logout
            </button>
            <button
              className="mt-2 w-full rounded-md bg-blue-600 px-2 py-1 text-xs font-semibold text-white hover:bg-blue-700"
              onClick={handleOpenCreateGroup}
              type="button"
            >
              Create Group
            </button>
          </div>
          <div className="p-2">
            {chats.length === 0 && (
              <p className="px-2 py-1 text-sm text-slate-500">
                No conversations found.
              </p>
            )}
            {chats.map((chat) => {
              const otherMember = !chat.isGroup
                ? (chat.members ?? []).find((m: ChatMember) => {
                    if (!m.username) return false;
                    if (!currentSub) return true;
                    return m.username !== currentSub;
                  }) ?? null
                : null;

              const isOtherOnline = Boolean(
                otherMember?.online ?? otherMember?.isOnline ?? false
              );

              return (
              <button
                key={chat.id}
                className={`mb-2 w-full rounded-lg px-3 py-2 text-left text-sm transition ${
                  chat.id === activeRoomId
                    ? "bg-blue-600 text-white"
                    : "bg-white text-slate-700 hover:bg-slate-100"
                }`}
                onClick={() => setActiveRoomId(chat.id)}
                type="button"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    {chat.isGroup ? (
                      <div className="flex items-center gap-2">
                        <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-slate-200 text-slate-800">
                          G
                        </span>
                        <div className="truncate font-medium">
                          {chat.groupName || "Group"}
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex h-2 w-2 rounded-full ${
                            isOtherOnline ? "bg-green-500" : "bg-slate-400"
                          }`}
                        />
                        <div className="truncate font-medium">
                          {resolveDirectChatTitle(chat)}
                        </div>
                      </div>
                    )}
                  </div>

                  {!chat.isGroup && (
                    <div className="shrink-0 text-xs opacity-80">
                      {isOtherOnline ? "Online" : "Offline"}
                    </div>
                  )}
                </div>
              </button>
              );
            })}
          </div>
        </aside>

        <main className="flex flex-1 flex-col">
          <header className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-base font-semibold">
              {activeChat?.isGroup ? (
                activeChat.groupName || "Group"
              ) : (
                resolveDirectChatTitle(activeChat)
              )}
            </h2>
            {activeChat?.isGroup && (
              <button
                className="mt-2 rounded-md bg-slate-200 px-2 py-1 text-xs text-slate-700 hover:bg-slate-300"
                onClick={handleOpenInvite}
                type="button"
              >
                Add Member
              </button>
            )}
            {sendMessage && (
              <p className="mt-1 text-xs text-red-600">{sendMessage}</p>
            )}
          </header>

          <section className="flex-1 space-y-3 overflow-y-auto bg-slate-100 p-5">
            {messages.map((message) => {
              const isMine =
                Boolean(message.mine) ||
                message.sender === "Me" ||
                (currentSub ? message.sender === currentSub : false);

              return (
                <div
                  key={message.id}
                  className={`flex ${isMine ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[70%] rounded-2xl px-4 py-2 text-sm shadow ${
                      isMine
                        ? "rounded-br-sm bg-blue-600 text-white"
                        : "rounded-bl-sm bg-white text-slate-900"
                    }`}
                  >
                    {activeChat?.isGroup && (
                      <p className="mb-1 text-[11px] opacity-75">
                        {message.sender}
                      </p>
                    )}
                    <p>{message.content}</p>
                    <p className="mt-1 text-right text-[10px] opacity-70">
                      {formatTime(message.createdAt)}
                    </p>
                  </div>
                </div>
              );
            })}
            <div ref={messageListEndRef} />
          </section>

          <footer className="border-t border-slate-200 bg-white p-4">
            <form
              className="flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                handleSend();
              }}
            >
              <input
                className="flex-1 rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-blue-500"
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Type a message and press Enter..."
                value={draft}
              />
              <button
                className="rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700"
                type="submit"
              >
                Send
              </button>
            </form>
          </footer>
        </main>

        {showCreateGroup && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold">Create Group</h3>
                  <p className="mt-1 text-sm text-slate-600">
                    Select members to create a new group chat.
                  </p>
                </div>
                <button
                  className="rounded-full bg-slate-200 px-2 py-1 text-xs text-slate-700 hover:bg-slate-300"
                  type="button"
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
                />

                <div className="max-h-60 overflow-y-auto rounded-xl border border-slate-100 bg-slate-50 p-3">
                  {usersLoading && (
                    <p className="text-sm text-slate-600">Loading users...</p>
                  )}
                  {!usersLoading && allUsers.length === 0 && (
                    <p className="text-sm text-slate-600">
                      No users available.
                    </p>
                  )}
                  {usersError && (
                    <p className="text-sm text-red-600">{usersError}</p>
                  )}
                  <div className="space-y-2">
                    {allUsers.map((u) => {
                      const isCurrent = Boolean(currentSub && u.name === currentSub);
                      const checked = createGroupSelectedUserIds.includes(
                        u.id ?? ""
                      );
                      return (
                        <label
                          key={u.id ?? u.name}
                          className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2 py-2 ${
                            isCurrent ? "opacity-50" : "hover:bg-white"
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">
                              {u.name ?? "Unknown"}
                            </div>
                            <div className="text-xs text-slate-500">
                              {u.online || u.isOnline ? "Online" : "Offline"}
                            </div>
                          </div>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={isCurrent}
                            onChange={(e) => {
                              const next = new Set(createGroupSelectedUserIds);
                              if (e.target.checked) {
                                if (u.id) next.add(String(u.id));
                              } else {
                                if (u.id) next.delete(String(u.id));
                              }
                              setCreateGroupSelectedUserIds(Array.from(next));
                            }}
                          />
                        </label>
                      );
                    })}
                  </div>
                </div>

                {modalMessage && (
                  <p className="text-sm text-red-600">{modalMessage}</p>
                )}

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    className="rounded-xl bg-slate-200 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-300"
                    type="button"
                    onClick={() => setShowCreateGroup(false)}
                  >
                    Cancel
                  </button>
                  <button
                    className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-blue-300"
                    type="button"
                    onClick={() => void handleCreateGroup()}
                    disabled={usersLoading}
                  >
                    Create
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {showInviteMember && activeChat?.isGroup && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold">Invite Member</h3>
                  <p className="mt-1 text-sm text-slate-600">
                    Choose a user to add to this group.
                  </p>
                </div>
                <button
                  className="rounded-full bg-slate-200 px-2 py-1 text-xs text-slate-700 hover:bg-slate-300"
                  type="button"
                  onClick={() => setShowInviteMember(false)}
                >
                  X
                </button>
              </div>

              <div className="mt-4 space-y-3">
                <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                  {usersLoading && (
                    <p className="text-sm text-slate-600">Loading users...</p>
                  )}
                  {!usersLoading && (
                    (() => {
                      const existingUsernames = new Set(
                        (activeChat.members ?? [])
                          .map((m: ChatMember) => m.name)
                          .filter((x: string | undefined): x is string => typeof x === "string" && x.length > 0)
                      );
                      const candidates = allUsers.filter((u) => {
                        if (!u.id || !u.name) return false;
                        if (currentSub && u.name === currentSub) return false;
                        return !existingUsernames.has(u.name);
                      });

                      return (
                        <select
                          className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-blue-500"
                          value={inviteUserId}
                          onChange={(e) => setInviteUserId(e.target.value)}
                        >
                          <option value="">Select user...</option>
                          {candidates.map((u) => (
                              <option key={u.id ?? u.name} value={String(u.id)}>
                              {u.name ?? "Unknown"}{" "}
                              {(u.online === true) ? "(Online)" : "(Offline)"}
                            </option>
                          ))}
                        </select>
                      );
                    })()
                  )}
                </div>

                {modalMessage && (
                  <p className="text-sm text-red-600">{modalMessage}</p>
                )}

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    className="rounded-xl bg-slate-200 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-300"
                    type="button"
                    onClick={() => setShowInviteMember(false)}
                  >
                    Cancel
                  </button>
                  <button
                    className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-blue-300"
                    type="button"
                    onClick={() => void handleInviteMember()}
                    disabled={usersLoading || !inviteUserId}
                  >
                    Invite
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
