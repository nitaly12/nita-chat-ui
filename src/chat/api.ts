import axios from "axios";
import type { AuthResult, Chat, ChatMember, ChatMessage, UserSummary } from "./types";

export const backendApi = axios.create({
  baseURL: "http://localhost:8080",
});

/** Auth routes proxied through Next.js (no baseURL) to avoid CORS/header limits. */
export const webApi = axios.create();
type ReadMode = "unknown" | "emptyBody" | "jsonBody" | "disabled";
let readMode: ReadMode = "unknown";

const authHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
});
const BACKEND_ORIGIN = "http://localhost:8080";
const toAbsoluteBackendUrl = (raw: string | undefined): string | undefined => {
  if (!raw) return undefined;
  const value = raw.trim();
  if (!value) return undefined;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("//")) return `http:${value}`;
  if (value.startsWith("/")) return `${BACKEND_ORIGIN}${value}`;
  return `${BACKEND_ORIGIN}/${value}`;
};

const decodeJwtPayload = (token: string): Record<string, unknown> | null => {
  try {
    const [, payload] = token.split(".");
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      "="
    );
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return null;
  }
};

/** Fallback when `/api/users/me` is unavailable; reads typical JWT claims. */
export const parseJwtIdentity = (
  token: string
): { userId: string | null; username: string | null } => {
  const p = decodeJwtPayload(token);
  if (!p) return { userId: null, username: null };
  const uid = p.userId ?? p.uid ?? p.id;
  return {
    userId: uid != null ? String(uid) : null,
    username: typeof p.sub === "string" ? p.sub : null,
  };
};

const mapMember = (value: unknown): ChatMember => {
  const v = (value ?? {}) as Record<string, unknown>;
  const username =
    v.username ?? v.userName ?? v.user_name ?? v.name ?? v.displayName;
  const onlineVal = v.online ?? v.isOnline ?? v.onlineStatus ?? v.status;
  let online: boolean | undefined;
  if (typeof onlineVal === "boolean") online = onlineVal;
  else if (typeof onlineVal === "string") {
    const s = onlineVal.toLowerCase();
    online = s.includes("online") || s === "true";
  }
  return {
    id: v.id != null ? String(v.id) : undefined,
    username: typeof username === "string" ? username : undefined,
    name: typeof username === "string" ? username : undefined,
    online,
    isOnline: typeof onlineVal === "boolean" ? onlineVal : undefined,
    onlineStatus: typeof onlineVal === "string" ? onlineVal : undefined,
  };
};

const mapChat = (value: unknown): Chat => {
  const v = (value ?? {}) as Record<string, unknown>;
  const isGroupRaw = v.isGroup ?? v.group ?? v.type === "GROUP";
  const isGroup =
    typeof isGroupRaw === "boolean"
      ? isGroupRaw
      : typeof isGroupRaw === "string"
        ? isGroupRaw.toLowerCase() === "true"
        : Boolean(isGroupRaw);
  const membersRaw = v.members ?? v.users ?? v.participants ?? [];
  const members = Array.isArray(membersRaw) ? membersRaw.map(mapMember) : [];
  const lastMessageRaw = v.lastMessage ?? v.last_message ?? v.recentMessage;
  const lastMessagePreview =
    typeof lastMessageRaw === "string"
      ? lastMessageRaw
      : typeof (lastMessageRaw as Record<string, unknown> | undefined)?.content ===
            "string"
        ? String((lastMessageRaw as Record<string, unknown>).content)
        : "";
  const lastMsgObj =
    lastMessageRaw && typeof lastMessageRaw === "object"
      ? (lastMessageRaw as Record<string, unknown>)
      : null;
  const lastMessageAtRaw =
    v.lastMessageAt ??
    v.last_message_at ??
    v.updatedAt ??
    lastMsgObj?.createdAt ??
    lastMsgObj?.timestamp ??
    lastMsgObj?.sentAt;
  const lastMessageAt =
    typeof lastMessageAtRaw === "string" && lastMessageAtRaw.length > 0
      ? lastMessageAtRaw
      : undefined;
  const unreadRaw = v.unreadCount ?? v.unread ?? v.unreadMessages;
  const unreadCount =
    typeof unreadRaw === "number"
      ? unreadRaw
      : typeof unreadRaw === "string" && /^\d+$/.test(unreadRaw)
        ? Number(unreadRaw)
        : undefined;
  return {
    id: String(v.id ?? v.roomId ?? v.chatRoomId ?? ""),
    isGroup,
    groupName: String(v.groupName ?? v.name ?? ""),
    directName:
      typeof (v.otherUsername ?? v.partnerUsername) === "string"
        ? String(v.otherUsername ?? v.partnerUsername)
        : undefined,
    lastMessagePreview,
    lastMessageAt,
    unreadCount,
    members,
  };
};

const parseReadByList = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (entry && typeof entry === "object") {
        const o = entry as Record<string, unknown>;
        const u =
          o.username ?? o.userName ?? o.name ?? o.userId ?? o.id;
        return u != null ? String(u) : "";
      }
      return "";
    })
    .filter(Boolean);
};

const mapMessage = (value: unknown): ChatMessage => {
  const v = (value ?? {}) as Record<string, unknown>;
  const senderName =
    v.senderUsername ??
    v.senderName ??
    v.sender ??
    v.username ??
    v.user ??
    "Unknown";
  const senderId = v.senderId ?? v.userId ?? v.authorId;
  const content = v.content ?? v.message ?? v.text ?? "";
  const readAtRaw = v.readAt ?? v.read_at ?? v.seenAt ?? v.seen_at;
  const readAt =
    typeof readAtRaw === "string" && readAtRaw.length > 0 ? readAtRaw : undefined;
  const seenRaw = v.seen ?? v.read ?? v.isRead ?? v.readFlag;
  const seen =
    typeof seenRaw === "boolean"
      ? seenRaw
      : typeof seenRaw === "string"
        ? seenRaw.toLowerCase() === "true"
        : Boolean(readAt);
  const readBy = parseReadByList(
    v.readBy ?? v.read_by ?? v.readReceipts ?? v.readReceipt ?? v.seenBy
  );
  const editedAtRaw = v.editedAt ?? v.edited_at ?? v.updatedAt ?? v.modifiedAt;
  const editedAt =
    typeof editedAtRaw === "string" && editedAtRaw.length > 0 ? editedAtRaw : undefined;
  const mediaUrlRaw =
    v.attachmentUrl ?? v.attachment_url ?? v.mediaUrl ?? v.media_url ?? v.fileUrl;
  const mediaUrl = toAbsoluteBackendUrl(
    typeof mediaUrlRaw === "string" ? mediaUrlRaw : undefined
  );
  const mediaTypeRaw =
    v.attachmentType ?? v.attachment_type ?? v.mediaType ?? v.media_type ?? v.fileType;
  const mediaNameRaw = v.attachmentName ?? v.attachment_name ?? v.fileName ?? v.filename;
  const mediaName =
    typeof mediaNameRaw === "string" && mediaNameRaw.trim().length > 0
      ? mediaNameRaw.trim()
      : undefined;
  const mediaType =
    mediaTypeRaw === "image" || mediaTypeRaw === "file"
      ? mediaTypeRaw
      : mediaUrl && /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(mediaUrl)
        ? "image"
        : mediaUrl
          ? "file"
          : undefined;
  const reactionList = Array.isArray(v.reactions) ? v.reactions : [];
  const reactionMap: Record<string, number> = {};
  for (const r of reactionList) {
    const rr = (r ?? {}) as Record<string, unknown>;
    const emoji = rr.emoji;
    const countRaw = rr.count ?? rr.total;
    if (typeof emoji !== "string") continue;
    const count =
      typeof countRaw === "number"
        ? countRaw
        : typeof countRaw === "string" && /^\d+$/.test(countRaw)
          ? Number(countRaw)
          : 1;
    reactionMap[emoji] = count;
  }
  const myReactionRaw = v.myReaction ?? v.my_reaction ?? v.selfReaction;
  const myReaction =
    typeof myReactionRaw === "string" && myReactionRaw.trim().length > 0
      ? myReactionRaw.trim()
      : undefined;
  return {
    id: String(v.id ?? v.messageId ?? crypto.randomUUID()),
    roomId: String(v.roomId ?? v.chatRoomId ?? ""),
    senderId: senderId != null ? String(senderId) : undefined,
    sender: String(senderName),
    content: String(content),
    createdAt: String(v.createdAt ?? v.timestamp ?? new Date().toISOString()),
    readAt,
    seen,
    readBy: readBy.length > 0 ? readBy : undefined,
    editedAt,
    mediaUrl,
    mediaType,
    mediaName,
    reactions: Object.keys(reactionMap).length > 0 ? reactionMap : undefined,
    myReaction,
  };
};

export const normalizeMessageBody = (value: unknown): ChatMessage => mapMessage(value);

const unwrapList = (value: unknown, keys: string[]): unknown[] => {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  const v = value as Record<string, unknown>;
  for (const key of keys) {
    if (Array.isArray(v[key])) return v[key] as unknown[];
  }
  return [];
};

const mapUserSummary = (value: unknown): UserSummary | null => {
  const v = (value ?? {}) as Record<string, unknown>;
  const idRaw = v.id ?? v.userId ?? v.user_id;
  const username = v.username ?? v.userName ?? v.user_name ?? v.name ?? v.email;
  if (idRaw == null || typeof username !== "string" || !username.trim()) return null;
  const onlineVal = v.online ?? v.isOnline ?? v.onlineStatus ?? v.status;
  let online: boolean | undefined;
  if (typeof onlineVal === "boolean") online = onlineVal;
  else if (typeof onlineVal === "string") {
    const s = onlineVal.toLowerCase();
    online = s.includes("online") || s === "true";
  }
  return { id: String(idRaw), username: username.trim(), online };
};

export const chatApi = {
  async login(username: string, password: string): Promise<AuthResult> {
    const response = await webApi.post("/api/auth/login", { username, password });
    const token = String(
      (response.data as Record<string, unknown>)?.accessToken ??
        (response.data as Record<string, unknown>)?.token ??
        ""
    );
    const payload = decodeJwtPayload(token);
    const sub = payload?.sub;
    const uid = payload?.userId ?? payload?.uid ?? payload?.id;
    return {
      token,
      currentUserId: uid != null ? String(uid) : null,
      currentUsername: typeof sub === "string" ? sub : null,
    };
  },

  async register(username: string, password: string): Promise<void> {
    await webApi.post("/api/auth/register", { username, password });
  },

  async getChats(token: string): Promise<Chat[]> {
    const response = await backendApi.get("/api/chats", { headers: authHeaders(token) });
    return unwrapList(response.data, ["chats", "data", "rooms"]).map(mapChat);
  },

  async getMe(token: string): Promise<{ id: string | null; username: string | null }> {
    const response = await backendApi.get("/api/users/me", {
      headers: authHeaders(token),
    });
    const v = (response.data ?? {}) as Record<string, unknown>;
    const idRaw = v.id ?? v.userId ?? v.user_id;
    const username = v.username ?? v.userName ?? v.user_name ?? v.name ?? v.email;
    return {
      id: idRaw != null ? String(idRaw) : null,
      username: typeof username === "string" ? username.trim() : null,
    };
  },

  async getUsersList(token: string): Promise<UserSummary[]> {
    const response = await backendApi.get("/api/users", { headers: authHeaders(token) });
    const rows = unwrapList(response.data, ["users", "members", "data", "content"]);
    return rows
      .map(mapUserSummary)
      .filter((u): u is UserSummary => u !== null);
  },

  async createGroup(
    token: string,
    name: string,
    memberIds: (string | number)[]
  ): Promise<string | null> {
    const response = await backendApi.post(
      "/api/chats/group",
      { name, memberIds },
      { headers: authHeaders(token) }
    );
    const v = (response.data ?? {}) as Record<string, unknown>;
    const roomId =
      v.roomId ??
      v.id ??
      (v.room as Record<string, unknown> | undefined)?.id ??
      (v.chat as Record<string, unknown> | undefined)?.id;
    return roomId != null ? String(roomId) : null;
  },

  async getRoomHistory(token: string, roomId: string): Promise<ChatMessage[]> {
    const response = await backendApi.get(`/api/rooms/${roomId}/history`, {
      headers: authHeaders(token),
    });
    return unwrapList(response.data, ["messages", "content", "data"]).map(mapMessage);
  },

  async startPrivateChat(token: string, userId: string): Promise<string | null> {
    const response = await backendApi.post(
      `/api/chats/private/${userId}`,
      {},
      { headers: authHeaders(token) }
    );
    const v = (response.data ?? {}) as Record<string, unknown>;
    const roomId = v.roomId ?? v.id ?? (v.room as Record<string, unknown> | undefined)?.id;
    return roomId != null ? String(roomId) : null;
  },

  async sendMessage(token: string, roomId: string, content: string): Promise<ChatMessage | null> {
    const response = await backendApi.post(
      "/api/messages",
      { roomId, content, attachmentUrl: "", attachmentType: "", attachmentName: "" },
      { headers: authHeaders(token) }
    );
    if (!response.data) return null;
    return mapMessage(response.data);
  },

  async sendMediaMessage(
    token: string,
    roomId: string,
    file: File
  ): Promise<ChatMessage | null> {
    const form = new FormData();
    form.append("file", file);
    const upload = await backendApi.post("/api/uploads", form, {
      headers: {
        ...authHeaders(token),
      },
    });
    const uploadBody = (upload.data ?? {}) as Record<string, unknown>;
    const uploadedUrlRaw =
      uploadBody.url ??
      uploadBody.fileUrl ??
      uploadBody.mediaUrl ??
      uploadBody.path ??
      uploadBody.location ??
      uploadBody.data;
    const uploadedUrl =
      typeof uploadedUrlRaw === "string" && uploadedUrlRaw.trim().length > 0
        ? uploadedUrlRaw.trim()
        : "";
    if (!uploadedUrl) return null;
    const absoluteUrl = toAbsoluteBackendUrl(uploadedUrl) ?? uploadedUrl;

    const response = await backendApi.post(
      "/api/messages",
      {
        roomId,
        content: "",
        attachmentUrl: absoluteUrl,
        attachmentType: file.type.startsWith("image/") ? "image" : "file",
        attachmentName: file.name,
      },
      { headers: authHeaders(token) }
    );
    if (!response.data) return null;
    return mapMessage(response.data);
  },

  async editMessage(token: string, messageId: string, content: string): Promise<void> {
    await backendApi.put(
      `/api/messages/${messageId}`,
      { content },
      { headers: authHeaders(token) }
    );
  },

  async deleteMessage(token: string, messageId: string): Promise<void> {
    await backendApi.delete(`/api/messages/${messageId}`, {
      headers: authHeaders(token),
    });
  },

  async inviteUserToGroup(token: string, roomId: string, userId: string): Promise<void> {
    await backendApi.post(
      `/api/chats/${roomId}/invite/${userId}`,
      {},
      { headers: authHeaders(token) }
    );
  },

  async reactToMessage(token: string, messageId: string, emoji: string): Promise<void> {
    await backendApi.post(
      `/api/messages/${messageId}/reactions`,
      { emoji },
      { headers: authHeaders(token) }
    );
  },

  async searchMessages(
    token: string,
    roomId: string,
    query: string
  ): Promise<ChatMessage[]> {
    const response = await backendApi.get("/api/messages/search", {
      headers: authHeaders(token),
      params: { roomId, q: query, query },
    });
    return unwrapList(response.data, ["messages", "content", "data"]).map(mapMessage);
  },

  /**
   * Removes a member from a group. Adjust path to match your Spring controller if needed.
   */
  async removeGroupMember(token: string, roomId: string, userId: string): Promise<void> {
    await backendApi.delete(`/api/chats/${roomId}/members/${userId}`, {
      headers: authHeaders(token),
    });
  },

  /** Marks the room as read for the current user. */
  async markRoomAsRead(token: string, roomId: string): Promise<void> {
    if (readMode === "disabled") return;
    const url = `/api/rooms/${roomId}/read`;
    const headers = authHeaders(token);

    const tryEmptyBody = async (): Promise<void> => {
      await backendApi.post(url, null, { headers });
    };
    const tryJsonBody = async (): Promise<void> => {
      await backendApi.post(url, { roomId }, { headers });
    };

    try {
      if (readMode === "emptyBody") {
        await tryEmptyBody();
        return;
      }
      if (readMode === "jsonBody") {
        await tryJsonBody();
        return;
      }

      // Unknown mode: probe common Spring signatures once.
      try {
        await tryEmptyBody();
        readMode = "emptyBody";
        return;
      } catch {
        await tryJsonBody();
        readMode = "jsonBody";
        return;
      }
    } catch (err) {
      // If backend does not support read receipts, disable further calls
      // to avoid repeated noisy failures in browser/network logs.
      if (axios.isAxiosError(err)) {
        const status = err.response?.status;
        if (status === 400 || status === 404 || status === 405) {
          readMode = "disabled";
          return;
        }
      }
      throw err;
    }
  },

  /** Optional: list read receipts for a room if backend provides them. */
  async getRoomReads(token: string, roomId: string): Promise<Record<string, string[]>> {
    const response = await backendApi.get(`/api/rooms/${roomId}/reads`, {
      headers: authHeaders(token),
    });
    const raw = response.data;
    if (!raw || typeof raw !== "object") return {};
    const record = raw as Record<string, unknown>;
    const out: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(record)) {
      if (Array.isArray(v)) out[k] = v.map((x) => String(x));
    }
    return out;
  },
};

export const deriveUsersFromChats = (
  chats: Chat[],
  currentUsername: string | null,
  currentUserId: string | null
): UserSummary[] => {
  const byId = new Map<string, UserSummary>();
  for (const chat of chats) {
    for (const member of chat.members ?? []) {
      if (!member.id || !member.username) continue;
      if (currentUserId && member.id === currentUserId) continue;
      if (currentUsername && member.username === currentUsername) continue;
      if (!byId.has(member.id)) {
        byId.set(member.id, {
          id: member.id,
          username: member.username,
          online: member.online ?? member.isOnline,
        });
      }
    }
  }
  return Array.from(byId.values());
};
