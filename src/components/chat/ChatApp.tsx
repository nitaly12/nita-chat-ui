"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import {
  chatApi,
  deriveUsersFromChats,
  enrichMessagesWithReplyParents,
  mergeUserSummaries,
  parseJwtIdentity,
  pickMessageReactionPatch,
} from "../../chat/api";
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
import FriendsMainView from "./FriendsMainView";
import HomeFeed from "./HomeFeed";
import FeedRightRail from "./FeedRightRail";
import TopAlert from "./TopAlert";
import ChatWindow from "./ChatWindow";
import ProfileSettingsModal from "./ProfileSettingsModal";
import { useChatRoomRealtime } from "./useChatRoomRealtime";
import { useChatSeenReceipt } from "./useChatSeenReceipt";
import ChatSkeleton from "../skeleton/ChatSkeleton";
import { SafeRemoteImage } from "../ui/SafeRemoteImage";
import { FriendshipUiProvider } from "../../contexts/FriendshipUiContext";

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
  const [emailInput, setEmailInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [statusTone, setStatusTone] = useState<"error" | "success">("error");
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
  const [appLoading, setAppLoading] = useState(false);
  const [chatSearchQuery, setChatSearchQuery] = useState("");
  /** Center column: Feed vs Friends hub vs chat room. */
  const [mainPane, setMainPane] = useState<"feed" | "friends" | "chat">("feed");
  const [authToastPreview, setAuthToastPreview] = useState<string | null>(null);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [feedRefreshNonce, setFeedRefreshNonce] = useState(0);
  const reactionReqSeqRef = useRef<Record<string, number>>({});

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
    setMainPane("feed");
    setExtraUnreadByRoom({});
    lastPreviewRef.current = {};
    chatsHydratedRef.current = false;
    setChatNotice("");
    setStatusTone("error");
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
      else {
        setStatusTone("error");
        setStatusMessage(fallbackMessage);
      }
    },
    [forceLogout, token]
  );

  const activeChat = useMemo(
    () => chats.find((chat) => chat.id === activeRoomId) ?? null,
    [activeRoomId, chats]
  );
  const feedPeerUsers = useMemo(() => {
    const byId = new Map<string, UserSummary>();
    for (const chat of chats) {
      if (chat.isGroup) continue;
      for (const m of chat.members ?? []) {
        if (!m.id) continue;
        if (currentUserId && String(m.id) === String(currentUserId)) continue;
        const username = (m.username ?? m.name ?? "").trim();
        if (
          currentUsername &&
          username &&
          username.toLowerCase() === currentUsername.trim().toLowerCase()
        ) {
          continue;
        }
        const fromUsers = users.find((u) => String(u.id) === String(m.id)) ?? null;
        byId.set(String(m.id), {
          id: String(m.id),
          username: (fromUsers?.username ?? username) || `User ${String(m.id)}`,
          displayName: fromUsers?.displayName ?? null,
          avatarUrl: fromUsers?.avatarUrl ?? m.avatarUrl ?? null,
          online: fromUsers?.online ?? m.online ?? m.isOnline,
        });
      }
    }
    return Array.from(byId.values());
  }, [chats, currentUserId, currentUsername, users]);

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
    setAppLoading(true);
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
    } finally {
      setAppLoading(false);
    }
  }, [token, handleApiError]);

  const refreshChatsAndUsersAfterSocial = useCallback(async () => {
    await loadAppData();
    setFeedRefreshNonce((v) => v + 1);
  }, [loadAppData]);

  const startPrivateChatForAcceptedFriend = useCallback(
    (peerUserId: string) => chatApi.startPrivateChat(token, peerUserId),
    [token]
  );

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
      setMessages(enrichMessagesWithReplyParents(merged));
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
      if (roomId) {
        setActiveRoomId(roomId);
        setMainPane("chat");
      } else setChatNotice("Group created, but the server did not return a room id.");
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
      const incoming: ChatMessage = {
        ...msg,
        parentMessage: msg.parentMessage ? { ...msg.parentMessage } : undefined,
        parentMessageId: msg.parentMessageId ?? msg.parentMessage?.id,
      };
      const roomId = String(incoming.roomId ?? "");
      const mine = isMessageFromCurrentUser(incoming, currentUserId, currentUsername);
      const roomIsActive = roomId !== "" && roomId === activeRoomId;
      if (!mine && !roomIsActive) {
        const senderName = incoming.sender?.trim() || "New message";
        const userMatch =
          users.find(
            (u) =>
              (incoming.senderId != null && String(u.id) === String(incoming.senderId)) ||
              String(u.username).toLowerCase() === senderName.toLowerCase()
          ) ?? null;
        const previewText =
          incoming.mediaType === "voice"
            ? "Sent a voice message"
            : incoming.mediaType === "image"
              ? "Sent an image"
              : incoming.mediaType === "file"
                ? "Sent a file"
                : (incoming.content || "").trim() || "New message";
        setTopAlert({
          id: `${roomId}:${String(incoming.id)}:${Date.now()}`,
          roomId,
          senderName: userMatch?.displayName?.trim() || senderName,
          preview: previewText,
          avatarUrl: userMatch?.avatarUrl ?? null,
        });
      }

      setMessages((prev) => {
        const idKey = String(incoming.id);
        const existing = prev.find((m) => String(m.id) === idKey);
        if (existing) {
          const mergedParentMessage = incoming.parentMessage ?? existing.parentMessage;
          const mergedParentMessageId =
            incoming.parentMessageId ?? existing.parentMessageId ?? mergedParentMessage?.id;
          const next = prev.map((m) =>
            String(m.id) === idKey
              ? {
                  ...m,
                  ...incoming,
                  mine: m.mine ?? incoming.mine,
                  parentMessageId: mergedParentMessageId,
                  parentMessage: mergedParentMessage,
                }
              : m
          );
          return dedupeMessagesKeepFirst(next);
        }

        const fromMe = isMessageFromCurrentUser(incoming, currentUserId, currentUsername);
        let next = prev;
        if (fromMe) {
          next = prev.filter((m) => {
            if (!m.pending || !m.mine || m.roomId !== incoming.roomId) return true;
            if (m.content && incoming.content && m.content === incoming.content) return false;
            if (String(m.id).startsWith("temp-media-") && (incoming.mediaUrl || incoming.mediaType)) return false;
            if (String(m.id).startsWith("temp-voice-") && incoming.mediaType === "voice") return false;
            return true;
          });
        }

        const isMine =
          Boolean(
            currentUserId &&
              incoming.senderId != null &&
              String(incoming.senderId) === String(currentUserId)
          ) || Boolean(currentUsername && incoming.sender === currentUsername);
        return dedupeMessagesKeepFirst([...next, { ...incoming, mine: isMine || incoming.mine }]);
      });
    },
    [activeRoomId, currentUserId, currentUsername, users]
  );

  const onStompRoomReactionEvent = useCallback(
    (event: Record<string, unknown>) => {
      const messageId =
        event.messageId != null
          ? String(event.messageId)
          : event.message_id != null
            ? String(event.message_id)
            : "";
      if (!messageId) return;

      const replaceFromPayload =
        event.reactionSummary != null ||
        event.reaction_summary != null ||
        (event.reactions != null && typeof event.reactions === "object");

      const patch = pickMessageReactionPatch(event);
      if (replaceFromPayload || Object.keys(patch).length > 0) {
        setMessages((prev) =>
          prev.map((m) => (String(m.id) === messageId ? { ...m, ...patch } : m))
        );
        return;
      }

      const emoji = typeof event.emoji === "string" ? event.emoji.trim() : "";
      const totalRaw =
        event.count ??
        event.updatedCount ??
        event.totalCount ??
        event.emojiCount ??
        event.newCount;
      const totalForEmoji =
        typeof totalRaw === "number" && Number.isFinite(totalRaw)
          ? Math.max(0, Math.floor(totalRaw))
          : typeof totalRaw === "string" && /^\d+$/.test(String(totalRaw).trim())
            ? Math.max(0, Number(String(totalRaw).trim()))
            : null;

      if (emoji && totalForEmoji != null) {
        const myPatch = pickMessageReactionPatch(event);
        setMessages((prev) =>
          prev.map((m) => {
            if (String(m.id) !== messageId) return m;
            const nextMap = { ...(m.reactions ?? {}) };
            if (totalForEmoji <= 0) delete nextMap[emoji];
            else nextMap[emoji] = totalForEmoji;
            return {
              ...m,
              reactions: Object.keys(nextMap).length > 0 ? nextMap : undefined,
              reactionSummary: undefined,
              ...(myPatch.myReaction !== undefined ? { myReaction: myPatch.myReaction } : {}),
            };
          })
        );
        return;
      }

      if (!emoji) return;

      const action = String(event.action ?? "ADDED").toUpperCase();
      const actorId = event.userId != null ? String(event.userId) : null;
      const actorUsername = (typeof event.username === "string" ? event.username : "").trim().toLowerCase();
      const actorKey = actorId ?? (actorUsername.length > 0 ? actorUsername : null);
      const isMineEvent =
        (actorId != null && currentUserId != null && actorId === String(currentUserId)) ||
        (actorUsername.length > 0 &&
          currentUsername != null &&
          actorUsername === String(currentUsername).trim().toLowerCase());

      setMessages((prev) =>
        prev.map((m) => {
          if (String(m.id) !== messageId) return m;
          const nextMap = { ...(m.reactions ?? {}) };
          const nextUsers = { ...(m.reactionUsers ?? {}) };
          if (action === "REMOVED" || action === "DELETED" || action === "CANCELLED") {
            if (isMineEvent && m.myReaction !== emoji) {
              if (actorKey) {
                const users = (nextUsers[emoji] ?? []).filter((u) => u !== actorKey);
                if (users.length > 0) nextUsers[emoji] = users;
                else delete nextUsers[emoji];
              }
              return {
                ...m,
                reactionUsers: Object.keys(nextUsers).length > 0 ? nextUsers : undefined,
                reactionSummary: undefined,
                myReaction: m.myReaction,
              };
            }
            const curr = Math.max(0, (nextMap[emoji] ?? 0) - 1);
            if (curr > 0) nextMap[emoji] = curr;
            else delete nextMap[emoji];
            if (actorKey) {
              const users = (nextUsers[emoji] ?? []).filter((u) => u !== actorKey);
              if (users.length > 0) nextUsers[emoji] = users;
              else delete nextUsers[emoji];
            }
            return {
              ...m,
              reactions: Object.keys(nextMap).length > 0 ? nextMap : undefined,
              reactionUsers: Object.keys(nextUsers).length > 0 ? nextUsers : undefined,
              reactionSummary: undefined,
              myReaction: isMineEvent && m.myReaction === emoji ? undefined : m.myReaction,
            };
          }
          if (isMineEvent && m.myReaction === emoji) {
            if (actorKey) {
              const users = nextUsers[emoji] ?? [];
              if (!users.includes(actorKey)) nextUsers[emoji] = [...users, actorKey];
            }
            return {
              ...m,
              reactionUsers: Object.keys(nextUsers).length > 0 ? nextUsers : undefined,
              reactionSummary: undefined,
              myReaction: emoji,
            };
          }
          const users = nextUsers[emoji] ?? [];
          const alreadyInUsers = actorKey ? users.includes(actorKey) : false;
          nextMap[emoji] = (nextMap[emoji] ?? 0) + (alreadyInUsers ? 0 : 1);
          if (actorKey) nextUsers[emoji] = alreadyInUsers ? users : [...users, actorKey];
          return {
            ...m,
            reactions: nextMap,
            reactionUsers: Object.keys(nextUsers).length > 0 ? nextUsers : undefined,
            reactionSummary: undefined,
            myReaction: isMineEvent ? emoji : m.myReaction,
          };
        })
      );
    },
    [currentUserId, currentUsername]
  );

  const { sendTypingPing, typingUsers } = useChatRoomRealtime(
    token || null,
    activeRoomId || null,
    currentUsername,
    { onRoomMessage: onStompRoomMessage, onRoomReactionEvent: onStompRoomReactionEvent }
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

  /** After OTP reset flow: `/?passwordReset=1` shows sign-in hint and clears the query. */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("passwordReset") !== "1") return;
    params.delete("passwordReset");
    const qs = params.toString();
    const path = window.location.pathname;
    window.history.replaceState(null, "", qs ? `${path}?${qs}` : path);
    const saved = window.localStorage.getItem("accessToken") ?? "";
    if (saved) {
      setChatNotice("Your password was reset. Sign out and sign in again with your new password if needed.");
    } else {
      setStatusTone("success");
      setStatusMessage("Password updated. Sign in with your new password.");
    }
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
        const email = emailInput.trim();
        if (!email) {
          setStatusTone("error");
          setStatusMessage("Email is required.");
          return;
        }
        await chatApi.register(usernameInput.trim(), email, passwordInput.trim());
        setAuthMode("login");
        setStatusTone("success");
        setStatusMessage("Registered. Please login.");
        setEmailInput("");
        return;
      }
      const auth = await chatApi.login(usernameInput.trim(), passwordInput.trim());
      if (!auth.token) {
        setStatusTone("error");
        setStatusMessage("Login failed: missing token.");
        return;
      }
      window.localStorage.setItem("accessToken", auth.token);
      setToken(auth.token);
      setCurrentUserId(auth.currentUserId);
      setCurrentUsername(auth.currentUsername);
      setStatusMessage("");
      setUsernameInput("");
      setEmailInput("");
      setPasswordInput("");
      setPasswordVisible(false);
      await loadAppData();
    } catch {
      setStatusTone("error");
      setStatusMessage("");
      setAuthToastPreview("Authentication failed.");
      setPasswordVisible(false);
    }
  };

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#dde8e0] via-[#ebe4dc] to-[#d8e4f0] p-4">
        <TopAlert
          key={authToastPreview ?? "auth-toast-empty"}
          open={Boolean(authToastPreview)}
          senderName="Auth"
          preview={authToastPreview ?? ""}
          avatarUrl={null}
          onClose={() => setAuthToastPreview(null)}
          onClick={() => setAuthToastPreview(null)}
          durationMs={4500}
        />
        <div className="w-full max-w-sm rounded-3xl border border-[#b8c9bc]/70 bg-[#faf8f3]/95 p-6 shadow-[0_20px_50px_-12px_rgba(60,80,70,0.18)] backdrop-blur-sm sm:p-8">
          <h1 className="font-serif text-xl font-semibold tracking-tight text-[#2c3d33] sm:text-2xl">
            {authMode === "login" ? "Sign in" : "Create account"}
          </h1>
          <div className="mt-5 space-y-3">
            <input
              className="w-full rounded-2xl border border-[#b8c9bc] bg-[#fefcf8] px-4 py-3 text-sm text-[#2c3d33] outline-none placeholder:text-[#7a8f82] focus:border-[#7d9b84] focus:ring-2 focus:ring-[#7d9b84]/35"
              placeholder="Username"
              value={usernameInput}
              onChange={(e) => setUsernameInput(e.target.value)}
              autoComplete="username"
            />
            {authMode === "register" ? (
              <input
                className="w-full rounded-2xl border border-[#b8c9bc] bg-[#fefcf8] px-4 py-3 text-sm text-[#2c3d33] outline-none placeholder:text-[#7a8f82] focus:border-[#7d9b84] focus:ring-2 focus:ring-[#7d9b84]/35"
                type="email"
                placeholder="Email"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                autoComplete="email"
              />
            ) : null}
            <div className="relative">
              <input
                className="w-full rounded-2xl border border-[#b8c9bc] bg-[#fefcf8] px-4 py-3 pr-12 text-sm text-[#2c3d33] outline-none placeholder:text-[#7a8f82] focus:border-[#7d9b84] focus:ring-2 focus:ring-[#7d9b84]/35"
                type={passwordVisible ? "text" : "password"}
                placeholder="Password"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                autoComplete={authMode === "login" ? "current-password" : "new-password"}
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-xl px-2 py-1 text-sm text-[#4a6b7d] hover:bg-[#efeadf] focus:outline-none focus:ring-2 focus:ring-[#7d9b84]/35"
                aria-label={passwordVisible ? "Hide password" : "Show password"}
                onClick={() => setPasswordVisible((v) => !v)}
              >
                {passwordVisible ? "🙈" : "👁"}
              </button>
            </div>
            {statusMessage && (
              <p
                className={`text-sm ${
                  statusTone === "success" ? "text-emerald-700" : "text-red-700"
                }`}
              >
                {statusMessage}
              </p>
            )}
            <button
              className="w-full rounded-2xl bg-[#7d9b84] py-3.5 text-sm font-semibold text-white shadow-md shadow-[#5a7a62]/25 hover:bg-[#6d8a74]"
              type="button"
              onClick={() => void handleAuth()}
            >
              {authMode === "login" ? "Sign in" : "Create account"}
            </button>
            {authMode === "login" ? (
              <div className="text-center">
                <Link
                  href="/forgot-password"
                  className="text-sm font-medium text-[#4a6b7d] underline decoration-[#4a6b7d]/30 underline-offset-4 hover:text-[#3d5a6a]"
                >
                  Forgot password?
                </Link>
              </div>
            ) : null}
            <button
              className="w-full text-sm font-medium text-[#4a5c52] underline decoration-[#4a5c52]/30 underline-offset-4"
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

  if (appLoading && chats.length === 0) {
    return <ChatSkeleton />;
  }

  return (
    <FriendshipUiProvider
      key={token || "session"}
      token={token}
      onRefreshChatsAndUsers={refreshChatsAndUsersAfterSocial}
      startPrivateChat={startPrivateChatForAcceptedFriend}
    >
    <div className="h-screen bg-gradient-to-br from-[#e8efe8] via-[#f2ede6] to-[#e3ecf5] p-0 dark:from-slate-950 dark:via-slate-900 dark:to-slate-900 sm:p-3">
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
          setMainPane("chat");
          setTopAlert(null);
        }}
      />
      <div className="mx-auto flex h-full max-w-[1600px] flex-col overflow-hidden border border-[#c7d5cb] bg-[#fbfaf6] shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:rounded-3xl">
        <header className="relative flex flex-wrap items-center justify-between gap-2 border-b border-[#d7e2d9] bg-[#fcfbf7] px-3 py-3 dark:border-slate-700 dark:bg-slate-900/80 sm:gap-4 sm:px-5">
          {chatDebugOn ? (
            <div className="absolute left-1/2 top-2 z-50 -translate-x-1/2 rounded-full border border-amber-400 bg-amber-100 px-3 py-1 text-[10px] font-semibold text-amber-950 shadow dark:border-amber-500 dark:bg-amber-950/90 dark:text-amber-100">
              CHAT_DEBUG — see DevTools console + voice bubble panels
            </div>
          ) : null}
          <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
            <nav
              className="order-1 flex min-w-0 max-w-full flex-1 items-center gap-0.5 overflow-x-auto rounded-2xl border border-[#d7e2d9] bg-[#f7f4ec] p-1 dark:border-slate-600 dark:bg-slate-800/80 sm:flex-none"
              aria-label="Main views"
            >
              <button
                type="button"
                onClick={() => {
                  setMainPane("feed");
                  setActiveRoomId("");
                }}
                className={`shrink-0 whitespace-nowrap rounded-xl px-3 py-1.5 text-xs font-semibold sm:text-sm ${
                  mainPane === "feed"
                    ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100"
                    : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
                }`}
              >
                Feed
              </button>
              <button
                type="button"
                onClick={() => {
                  setMainPane("friends");
                  setActiveRoomId("");
                }}
                className={`shrink-0 whitespace-nowrap rounded-xl px-3 py-1.5 text-xs font-semibold sm:text-sm ${
                  mainPane === "friends"
                    ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100"
                    : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
                }`}
              >
                Friends
              </button>
              <button
                type="button"
                onClick={() => setMainPane("chat")}
                className={`shrink-0 whitespace-nowrap rounded-xl px-3 py-1.5 text-xs font-semibold sm:text-sm ${
                  mainPane === "chat"
                    ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100"
                    : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
                }`}
              >
                Messages
              </button>
            </nav>
            <div className="relative order-3 hidden w-full max-w-md sm:order-2 sm:block sm:min-w-0 sm:flex-1">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                🔎
              </span>
              <input
                className="h-10 w-full rounded-xl border border-[#d7e2d9] bg-[#f7f4ec] pl-9 pr-3 text-sm text-slate-900 outline-none focus:border-[#7d9b84] dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
                placeholder="Search anything ..."
                value={chatSearchQuery}
                onChange={(e) => setChatSearchQuery(e.target.value)}
              />
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link
              href="/me/posts"
              className="inline-flex shrink-0 rounded-xl border border-[#d7e2d9] bg-[#f7f4ec] px-2.5 py-2 text-xs font-medium text-slate-700 hover:bg-[#efeadf] dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 sm:px-3"
            >
              <span className="sm:hidden">Posts</span>
              <span className="hidden sm:inline">My posts</span>
            </Link>
            {/* <button
              type="button"
              className="hidden h-9 w-9 items-center justify-center rounded-xl border border-[#d7e2d9] bg-[#f7f4ec] text-sm dark:border-slate-600 dark:bg-slate-800 sm:inline-flex"
              title="Messages"
            >
              💬
            </button>
            <button
              type="button"
              className="hidden h-9 w-9 items-center justify-center rounded-xl border border-[#d7e2d9] bg-[#f7f4ec] text-sm dark:border-slate-600 dark:bg-slate-800 sm:inline-flex"
              title="Notifications"
            >
              🔔
            </button> */}
            <button
              type="button"
              className="ml-1 flex max-w-[130px] items-center gap-2 rounded-xl border border-[#d7e2d9] bg-[#f7f4ec] px-2 py-1.5 text-left text-sm font-medium text-slate-700 hover:bg-[#efeadf] dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 sm:max-w-[220px]"
              title="Profile and settings"
              onClick={() => setShowProfileSettings(true)}
            >
              {profileAvatarUrl ? (
                <SafeRemoteImage
                  src={profileAvatarUrl}
                  alt=""
                  className="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-slate-200 dark:ring-slate-600"
                  variant="avatar"
                  loading="eager"
                  decoding="async"
                />
              ) : (
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-blue-500 to-blue-700 text-xs font-bold text-white">
                  {(profileDisplayName ?? currentUsername ?? "?").slice(0, 1).toUpperCase()}
                </span>
              )}
              <span className="min-w-0 truncate max-[420px]:hidden">{profileDisplayName ?? currentUsername ?? "User"}</span>
              <span className="shrink-0 text-slate-400" aria-hidden>
                ▾
              </span>
            </button>
          </div>
        </header>
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div
          className={
            mainPane === "chat" && !activeRoomId.trim()
              ? "flex min-h-0 w-full flex-1 flex-col md:h-full md:w-[300px] md:shrink-0 lg:w-[320px]"
              : "hidden min-h-0 md:flex md:h-full md:w-[300px] md:shrink-0 lg:w-[320px]"
          }
        >
        <ChatSidebar
          chats={chats}
          activeRoomId={activeRoomId}
          mainPane={mainPane}
          currentUsername={currentUsername}
          users={users}
          extraUnreadByRoom={extraUnreadByRoom}
          searchQuery={chatSearchQuery}
          onGoToFeed={() => {
            setMainPane("feed");
            setActiveRoomId("");
          }}
          onSelectRoom={(id) => {
            setExtraUnreadByRoom((p) => ({ ...p, [id]: 0 }));
            setActiveRoomId(id);
            setMainPane("chat");
          }}
          onLogout={() => {
            forceLogout("");
          }}
        />
        </div>

        <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#f9f7f2] dark:bg-slate-950/35">
          {mainPane === "feed" ? (
            <HomeFeed
              key={feedRefreshNonce}
              token={token}
              viewerAvatarUrl={profileAvatarUrl}
              viewerDisplayName={profileDisplayName ?? currentUsername}
              mode="news"
              newsUsers={feedPeerUsers}
            />
          ) : mainPane === "friends" ? (
            <FriendsMainView
              token={token}
              users={users}
              chats={chats}
              currentUsername={currentUsername}
              currentUserId={currentUserId}
            />
          ) : (
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
          onClose={() => {
            setActiveRoomId("");
          }}
          onSend={async (content, parentMessageId) => {
            if (!activeRoomId) return;
            const parentMessage =
              parentMessageId != null
                ? messages.find((m) => String(m.id) === String(parentMessageId))
                : undefined;
            const optimistic: ChatMessage = {
              id: `temp-${Date.now()}`,
              roomId: activeRoomId,
              sender: currentUsername ?? "You",
              senderId: currentUserId ?? undefined,
              content,
              parentMessageId: parentMessageId ?? undefined,
              parentMessage: parentMessage
                ? {
                    id: String(parentMessage.id),
                    sender: parentMessage.sender,
                    content: parentMessage.content,
                    contentSnippet: parentMessage.contentSnippet,
                    mediaUrl: parentMessage.mediaUrl,
                    mediaType: parentMessage.mediaType,
                  }
                : undefined,
              createdAt: new Date().toISOString(),
              mine: true,
              pending: true,
            };
            setMessages((prev) => [...prev, optimistic]);
            try {
              const sent = await chatApi.sendMessage(
                token,
                activeRoomId,
                content,
                parentMessageId
              );
              if (sent) {
                setMessages((prev) =>
                  dedupeMessagesKeepFirst(
                    prev.map((m) =>
                      m.id === optimistic.id
                        ? {
                            ...sent,
                            mine: true,
                            parentMessageId:
                              sent.parentMessageId ?? optimistic.parentMessageId,
                            parentMessage:
                              sent.parentMessage ?? optimistic.parentMessage,
                          }
                        : m
                    )
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
            const target = prevMessages.find((m) => m.id === messageId);
            const prevMine = target?.myReaction;
            const reqSeq = (reactionReqSeqRef.current[messageId] ?? 0) + 1;
            reactionReqSeqRef.current[messageId] = reqSeq;

            // Optimistic reaction update: instant toggle/replace in UI.
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id !== messageId) return m;
                const nextMap = { ...(m.reactions ?? {}) };
                const nextUsers = { ...(m.reactionUsers ?? {}) };
                const mine = m.myReaction;
                const selfKey = currentUserId != null ? String(currentUserId) : null;

                if (mine) {
                  nextMap[mine] = Math.max(0, (nextMap[mine] ?? 1) - 1);
                  if (nextMap[mine] === 0) delete nextMap[mine];
                  if (selfKey) {
                    const users = (nextUsers[mine] ?? []).filter((u) => u !== selfKey);
                    if (users.length > 0) nextUsers[mine] = users;
                    else delete nextUsers[mine];
                  }
                }

                if (mine === emoji) {
                  return {
                    ...m,
                    reactions: Object.keys(nextMap).length > 0 ? nextMap : undefined,
                    reactionUsers: Object.keys(nextUsers).length > 0 ? nextUsers : undefined,
                    myReaction: undefined,
                  };
                }

                nextMap[emoji] = (nextMap[emoji] ?? 0) + 1;
                if (selfKey) {
                  const users = nextUsers[emoji] ?? [];
                  if (!users.includes(selfKey)) nextUsers[emoji] = [...users, selfKey];
                }
                return {
                  ...m,
                  reactions: nextMap,
                  reactionUsers: Object.keys(nextUsers).length > 0 ? nextUsers : undefined,
                  myReaction: emoji,
                };
              })
            );

            try {
              let updated:
                | {
                    reactions?: Record<string, number>;
                    reactionSummary?: Record<string, number>;
                    reactionUsers?: Record<string, string[]>;
                    myReaction?: string | null;
                  }
                | null = null;

              if (prevMine === emoji) {
                const removed = await chatApi.unreactToMessage(token, messageId, emoji);
                if (!removed) {
                  throw new Error("Could not remove reaction.");
                }
              } else if (prevMine) {
                const removedPrev = await chatApi.unreactToMessage(
                  token,
                  messageId,
                  prevMine
                );
                if (!removedPrev) {
                  throw new Error("Could not replace reaction.");
                }
                updated = await chatApi.reactToMessage(token, messageId, emoji);
              } else {
                updated = await chatApi.reactToMessage(token, messageId, emoji);
              }

              // Ignore stale responses when user clicks quickly.
              if ((reactionReqSeqRef.current[messageId] ?? 0) !== reqSeq) return;
              if (
                updated &&
                (updated.reactions ||
                  updated.reactionSummary ||
                  updated.reactionUsers ||
                  typeof updated.myReaction !== "undefined")
              ) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === messageId
                      ? {
                          ...m,
                          reactions:
                            typeof updated.reactions !== "undefined"
                              ? updated.reactions
                              : m.reactions,
                          reactionSummary:
                            typeof updated.reactionSummary !== "undefined"
                              ? updated.reactionSummary
                              : m.reactionSummary,
                          reactionUsers:
                            typeof updated.reactionUsers !== "undefined"
                              ? updated.reactionUsers
                              : m.reactionUsers,
                          myReaction:
                            typeof updated.myReaction !== "undefined"
                              ? updated.myReaction ?? undefined
                              : m.myReaction,
                        }
                      : m
                  )
                );
              } else {
                await refreshHistory();
              }
            } catch (err) {
              if ((reactionReqSeqRef.current[messageId] ?? 0) === reqSeq) {
                setMessages(prevMessages);
              }
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
          )}
        </section>
        <FeedRightRail token={token} users={users} currentUsername={currentUsername} />
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
    </FriendshipUiProvider>
  );
}
