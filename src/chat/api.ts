import axios from "axios";
import { chatDebug, isChatDebug } from "./chatDebug";
import { extractUploadUrlFromResponse } from "./extractUploadUrl";
import { normalizeBackendTimestamp } from "./normalizeBackendTimestamp";
import { putUserProfileCoverUpdate, resolveChatBackendFetchUrl } from "./userProfileCoverHttp";
import type {
  AuthResult,
  Chat,
  ChatMember,
  ChatMessage,
  IncomingFriendRequest,
  FriendshipSnapshot,
  MyUserProfile,
  PostComment,
  UserPost,
  UserSummary,
} from "./types";

/** Best-effort Spring / REST error message for UI (e.g. `{ "message": "…" }`). */
export function readAxiosErrorMessage(err: unknown): string | null {
  if (!axios.isAxiosError(err) || err.response == null) return null;
  const d = err.response.data;
  if (typeof d === "string" && d.trim()) return d.trim();
  if (d && typeof d === "object") {
    const o = d as Record<string, unknown>;
    for (const k of ["message", "error", "detail", "title"]) {
      const v = o[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  return null;
}

/**
 * Spring API lives on the backend origin (e.g. `http://localhost:8080`), not on the Next dev host.
 * - `NEXT_PUBLIC_API_BASE` — preferred in `.env.local` (e.g. `http://localhost:8080`).
 * - `BACKEND_BASE_URL` — same as `next.config` rewrites target when you proxy `/backend`.
 * - Dev fallback: direct `http://localhost:8080` so `/api/...` hits Spring without relying on rewrites.
 * - Production fallback: same-origin `/backend` proxy (see `next.config.ts` rewrites).
 */
const RESOLVED_BACKEND_ORIGIN = (
  process.env.NEXT_PUBLIC_API_BASE?.trim() ||
  process.env.BACKEND_BASE_URL?.trim() ||
  (process.env.NODE_ENV === "development" ? "http://localhost:8080" : "/backend")
).replace(/\/+$/, "");

export const backendApi = axios.create({
  baseURL: RESOLVED_BACKEND_ORIGIN,
});

/** Auth routes proxied through Next.js (no baseURL) to avoid CORS/header limits. */
export const webApi = axios.create();
/** When POST /api/rooms/:id/read is missing (404/405), skip further calls. */
let roomReadEndpointAvailable = true;

const authHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
});
type FriendshipRowsCacheEntry = {
  rows: unknown[];
  fetchedAt: number;
};
const FRIENDSHIP_ROWS_TTL_MS = 15_000;
const friendshipRowsCacheByToken = new Map<string, FriendshipRowsCacheEntry>();
const friendshipRowsInflightByToken = new Map<string, Promise<unknown[]>>();
function clearFriendshipRowsCache(token?: string): void {
  if (token) {
    friendshipRowsCacheByToken.delete(token);
    friendshipRowsInflightByToken.delete(token);
    return;
  }
  friendshipRowsCacheByToken.clear();
  friendshipRowsInflightByToken.clear();
}
async function getFriendshipRowsCached(token: string): Promise<unknown[]> {
  const now = Date.now();
  const cached = friendshipRowsCacheByToken.get(token);
  if (cached && now - cached.fetchedAt < FRIENDSHIP_ROWS_TTL_MS) {
    return cached.rows;
  }
  const inflight = friendshipRowsInflightByToken.get(token);
  if (inflight) return inflight;
  const req = backendApi
    .get("/api/friendships", { headers: authHeaders(token) })
    .then((response) => {
      const rows = unwrapList(response.data, ["data", "content", "items", "friendships"]);
      friendshipRowsCacheByToken.set(token, { rows, fetchedAt: Date.now() });
      friendshipRowsInflightByToken.delete(token);
      return rows;
    })
    .catch((e) => {
      friendshipRowsInflightByToken.delete(token);
      throw e;
    });
  friendshipRowsInflightByToken.set(token, req);
  return req;
}
/** Public origin for `<audio src>` and `fetch` uploads (same as axios `backendApi` baseURL). */
export const CHAT_BACKEND_ORIGIN = RESOLVED_BACKEND_ORIGIN;
const BACKEND_ORIGIN = CHAT_BACKEND_ORIGIN;

/**
 * Resolves stored media/avatar paths for `<img src>`, `<audio src>`, and browser `fetch`.
 * - Same-origin prod: `CHAT_BACKEND_ORIGIN` is `/backend` (Next rewrites to Spring).
 * - If the API already returns `/backend/uploads/…`, avoid doubling to `/backend/backend/…`.
 * - Dev: absolute `http://localhost:8080` + path; strip a leading `/backend` when Spring serves `/uploads` at repo root.
 */
export function toPublicBackendUrl(raw: string | undefined | null): string | undefined {
  if (raw == null) return undefined;
  const value = String(raw).trim();
  if (!value) return undefined;
  if (value.startsWith("blob:") || value.startsWith("data:")) return value;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("//")) return `https:${value}`;

  const origin = BACKEND_ORIGIN.replace(/\/+$/, "");
  const path = value.startsWith("/") ? value : `/${value}`;

  if (origin === "/backend" && path.startsWith("/backend/")) return path;
  if (/^https?:\/\//i.test(origin) && path.startsWith("/backend/")) {
    return `${origin}${path.slice("/backend".length)}`;
  }

  return `${origin}${path}`;
}

const toAbsoluteBackendUrl = toPublicBackendUrl;

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
  const uid = p.userId ?? p.uid ?? p.id ?? p.user_id ?? p.memberId ?? p.userID ?? p.accountId;
  return {
    userId: uid != null ? String(uid) : null,
    username: typeof p.sub === "string" ? p.sub : null,
  };
};

/** Same as {@link parseJwtIdentity} plus numeric `sub` and other common claim keys (friendship direction). */
function viewerUserIdFromToken(token: string): string | null {
  const j = parseJwtIdentity(token);
  if (j.userId?.trim()) return j.userId.trim();
  const p = decodeJwtPayload(token);
  if (!p) return null;
  const sub = p.sub;
  if (typeof sub === "string" && /^\d+$/.test(sub.trim())) return sub.trim();
  return null;
}

const mapMember = (value: unknown): ChatMember => {
  const v = (value ?? {}) as Record<string, unknown>;
  const userObj = v.user && typeof v.user === "object" ? (v.user as Record<string, unknown>) : null;
  const username = v.username
  const onlineVal = v.online
  let online: boolean | undefined;
  if (typeof onlineVal === "boolean") online = onlineVal;
  else if (typeof onlineVal === "string") {
    const s = onlineVal.toLowerCase();
    online = s.includes("online") || s === "true";
  }
  const avatarRaw = v.avatarUrl
  const avatarUrl =
    typeof avatarRaw === "string" && avatarRaw.trim().length > 0 ? avatarRaw.trim() : undefined;
  const idRaw = v.id ?? v.userId ?? v.user_id ?? userObj?.id ?? userObj?.userId;
  return {
    id: idRaw != null ? String(idRaw) : undefined,
    username: typeof username === "string" ? username : undefined,
    name: typeof username === "string" ? username : undefined,
    avatarUrl,
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
  let members = Array.isArray(membersRaw) ? membersRaw.map(mapMember) : [];
  const lastMessageRaw = v.lastMessage ?? v.last_message ?? v.recentMessage;
  const lastMsgObj =
    lastMessageRaw && typeof lastMessageRaw === "object" && !Array.isArray(lastMessageRaw)
      ? (lastMessageRaw as Record<string, unknown>)
      : null;
  let lastMessagePreview = "";
  if (typeof lastMessageRaw === "string") {
    lastMessagePreview = lastMessageRaw.trim();
  } else if (lastMsgObj) {
    lastMessagePreview =
      firstNonEmptyString(
        lastMsgObj.content,
        lastMsgObj.text,
        lastMsgObj.body,
        lastMsgObj.message,
        lastMsgObj.preview
      ) ?? "";
  }
  if (!lastMessagePreview.trim()) {
    lastMessagePreview =
      firstNonEmptyString(
        v.lastMessagePreview,
        v.last_message_preview,
        v.lastMessageText,
        v.last_message_text,
        v.preview,
        v.snippet,
        v.lastText,
        v.last_text
      ) ?? "";
  }
  const lastMessageAtRaw =
    v.lastMessageAt ??
    v.last_message_at ??
    v.updatedAt ??
    lastMsgObj?.createdAt ??
    lastMsgObj?.timestamp ??
    lastMsgObj?.sentAt;
  const lastMessageAt =
    typeof lastMessageAtRaw === "string" && lastMessageAtRaw.length > 0
      ? (normalizeBackendTimestamp(lastMessageAtRaw) ?? lastMessageAtRaw)
      : undefined;
  const unreadRaw = v.unreadCount ?? v.unread ?? v.unreadMessages;
  const unreadCount =
    typeof unreadRaw === "number"
      ? unreadRaw
      : typeof unreadRaw === "string" && /^\d+$/.test(unreadRaw)
        ? Number(unreadRaw)
        : undefined;
  const roomAvatarRaw =
    v.avatarUrl ??
    v.avatar_url ??
    v.roomAvatarUrl ??
    v.room_avatar_url ??
    v.iconUrl ??
    v.imageUrl;
  const avatarUrl =
    typeof roomAvatarRaw === "string" && roomAvatarRaw.trim().length > 0
      ? roomAvatarRaw.trim()
      : undefined;
  const directName = firstNonEmptyString(
    typeof v.otherUsername === "string" ? v.otherUsername : undefined,
    typeof v.otherUserName === "string" ? v.otherUserName : undefined,
    typeof v.partnerUsername === "string" ? v.partnerUsername : undefined,
    typeof v.peerUsername === "string" ? v.peerUsername : undefined,
    typeof v.recipientUsername === "string" ? v.recipientUsername : undefined,
    typeof v.targetUsername === "string" ? v.targetUsername : undefined,
    typeof v.privateUsername === "string" ? v.privateUsername : undefined,
    typeof v.directName === "string" ? v.directName : undefined,
    typeof v.chatName === "string" ? v.chatName : undefined
  );
  if (!isGroup) {
    const peerIdRaw =
      v.otherUserId ??
      v.other_user_id ??
      v.otherId ??
      v.partnerId ??
      v.partnerUserId ??
      v.peerId ??
      v.opponentId ??
      v.recipientId ??
      v.targetUserId ??
      v.targetUser_id ??
      v.privateUserId;
    const peerId = peerIdRaw != null ? String(peerIdRaw) : undefined;
    const roomTitle = firstNonEmptyString(
      typeof v.name === "string" ? v.name : undefined,
      typeof v.groupName === "string" ? v.groupName : undefined
    );
    const peerName = firstNonEmptyString(directName, roomTitle);
    if (peerId || peerName) {
      const peerNorm = peerName?.trim().toLowerCase() ?? "";
      const duplicate = members.some(
        (m) =>
          (peerId != null && peerId !== "" && m.id === peerId) ||
          (peerNorm.length > 0 && m.username?.trim().toLowerCase() === peerNorm)
      );
      if (!duplicate) {
        members = members.concat([mapMember({ id: peerId, username: peerName })]);
      }
    }
  }
  return {
    id: String(v.id ?? v.roomId ?? v.chatRoomId ?? ""),
    isGroup,
    groupName: String(v.groupName ?? v.name ?? ""),
    directName,
    avatarUrl,
    lastMessagePreview,
    lastMessageAt,
    unreadCount,
    members,
  };
};

const firstNonEmptyString = (...candidates: unknown[]): string | undefined => {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim().length > 0) return c.trim();
  }
  return undefined;
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

const reactionUserListKeys = [
  "userIds",
  "user_ids",
  "users",
  "reactors",
  "reactedBy",
  "reacted_by",
] as const;

function parseUserIdsFromReactionEntry(usersRaw: unknown): string[] {
  if (!Array.isArray(usersRaw)) return [];
  return usersRaw
    .map((u) => {
      if (typeof u === "string" || typeof u === "number") return String(u);
      if (!u || typeof u !== "object") return "";
      const vv = u as Record<string, unknown>;
      const id = vv.id ?? vv.userId ?? vv.user_id ?? vv.username ?? vv.userName;
      return id != null ? String(id) : "";
    })
    .filter((x): x is string => x.trim().length > 0);
}

/**
 * Normalizes server reaction payloads into `reactions` + `reactionUsers`.
 * Supports (in order): `reactionSummary` / `reaction_summary`, `reactions` as a map,
 * then `reactions` as an array of `{ emoji, count?, userIds? }`.
 */
function parseMessageReactionsFromDto(v: Record<string, unknown>): {
  reactionMap: Record<string, number>;
  reactionUsers: Record<string, string[]>;
} {
  const reactionMap: Record<string, number> = {};
  const reactionUsers: Record<string, string[]> = {};

  const setUsers = (emoji: string, users: string[]): void => {
    const e = emoji.trim();
    if (!e || users.length === 0) return;
    reactionUsers[e] = Array.from(new Set([...(reactionUsers[e] ?? []), ...users]));
  };

  const setCount = (emoji: string, countRaw: unknown): void => {
    const e = typeof emoji === "string" ? emoji.trim() : "";
    if (!e) return;
    const count =
      typeof countRaw === "number" && Number.isFinite(countRaw)
        ? Math.max(0, Math.floor(countRaw))
        : typeof countRaw === "string" && /^\d+$/.test(countRaw.trim())
          ? Math.max(0, Number(countRaw.trim()))
          : 0;
    if (count > 0) reactionMap[e] = count;
    else delete reactionMap[e];
  };

  const applySummaryEntry = (emojiKey: string, val: unknown): void => {
    const emoji = emojiKey.trim();
    if (!emoji) return;
    if (typeof val === "number" || (typeof val === "string" && /^\d+$/.test(val.trim()))) {
      setCount(emoji, val);
      return;
    }
    if (!val || typeof val !== "object" || Array.isArray(val)) return;
    const o = val as Record<string, unknown>;
    const cRaw = o.count ?? o.total ?? o.reactionsCount ?? o.reactionCount ?? o.reactions_count;
    setCount(emoji, cRaw);
    for (const k of reactionUserListKeys) {
      const list = parseUserIdsFromReactionEntry(o[k]);
      if (list.length > 0) {
        setUsers(emoji, list);
        break;
      }
    }
  };

  const summaryRaw = v.reactionSummary ?? v.reaction_summary;
  if (summaryRaw && typeof summaryRaw === "object" && !Array.isArray(summaryRaw)) {
    for (const [key, val] of Object.entries(summaryRaw as Record<string, unknown>)) {
      applySummaryEntry(key, val);
    }
  } else if (Array.isArray(summaryRaw)) {
    for (const item of summaryRaw) {
      const r = (item ?? {}) as Record<string, unknown>;
      const em = typeof r.emoji === "string" ? r.emoji : null;
      if (!em) continue;
      const cRaw = r.count ?? r.total ?? r.reactionCount;
      setCount(em, cRaw);
      for (const k of reactionUserListKeys) {
        const list = parseUserIdsFromReactionEntry(r[k]);
        if (list.length > 0) {
          setUsers(em, list);
          break;
        }
      }
    }
  }

  const reactionsField = v.reactions;
  if (reactionsField && typeof reactionsField === "object" && !Array.isArray(reactionsField)) {
    for (const [key, val] of Object.entries(reactionsField as Record<string, unknown>)) {
      applySummaryEntry(key, val);
    }
  }

  if (Array.isArray(reactionsField)) {
    for (const r of reactionsField) {
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
      for (const k of reactionUserListKeys) {
        const users = parseUserIdsFromReactionEntry(rr[k]);
        if (users.length > 0) {
          setUsers(emoji, users);
          break;
        }
      }
    }
  }

  return { reactionMap, reactionUsers };
};

/**
 * Maps WebSocket / REST reaction payloads to message fields.
 * When `reactionSummary`, `reaction_summary`, or `reactions` is present, counts are **authoritative** (replace, not merge incrementally).
 */
export function pickMessageReactionPatch(
  v: Record<string, unknown>
): Partial<
  Pick<ChatMessage, "reactions" | "reactionUsers" | "myReaction" | "reactionSummary">
> {
  const patch: Partial<
    Pick<ChatMessage, "reactions" | "reactionUsers" | "myReaction" | "reactionSummary">
  > = {};
  const hasSummaryKey = "reactionSummary" in v || "reaction_summary" in v;
  const reactionsVal = v.reactions;
  const hasReactionsObject =
    reactionsVal != null && typeof reactionsVal === "object" && !Array.isArray(reactionsVal);
  const hasReactionsArray = Array.isArray(reactionsVal);

  if (hasSummaryKey || hasReactionsObject || hasReactionsArray) {
    const { reactionMap, reactionUsers } = parseMessageReactionsFromDto(v);
    const summaryCopy = { ...reactionMap };
    patch.reactionSummary = summaryCopy;
    patch.reactions = Object.keys(reactionMap).length > 0 ? { ...reactionMap } : undefined;
    patch.reactionUsers = Object.keys(reactionUsers).length > 0 ? reactionUsers : undefined;

    const summaryEmpty =
      Object.keys(summaryCopy).length === 0 ||
      Object.values(summaryCopy).every((n) => typeof n === "number" && n <= 0);
    if (
      summaryEmpty &&
      !("myReaction" in v) &&
      !("my_reaction" in v) &&
      !("selfReaction" in v)
    ) {
      patch.myReaction = undefined;
    }
  }

  if ("myReaction" in v || "my_reaction" in v || "selfReaction" in v) {
    const mrRaw = v.myReaction ?? v.my_reaction ?? v.selfReaction;
    if (mrRaw === null) patch.myReaction = undefined;
    else if (typeof mrRaw === "string") patch.myReaction = mrRaw.trim() || undefined;
  }
  return patch;
}

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
  const contentRaw = v.content ?? v.message ?? v.text ?? "";
  const content = String(contentRaw);
  const topMediaEarly = firstNonEmptyString(
    v.attachmentUrl,
    v.attachment_url,
    v.mediaUrl,
    v.media_url,
    v.fileUrl,
    v.file_url,
    v.url,
    v.path,
    v.filePath,
    v.location
  );
  let voiceFromJson: { audioUrl?: string; durationSec?: number } | null = null;
  if (content.trim().startsWith("{")) {
    try {
      const j = JSON.parse(content) as Record<string, unknown>;
      const typ = String(j.type ?? j.messageType ?? j.message_type ?? "").toLowerCase();
      if (typ === "voice") {
        const dRaw = j.durationSec ?? j.duration ?? j.lengthSec ?? j.length;
        const dNum =
          typeof dRaw === "number"
            ? dRaw
            : typeof dRaw === "string" && /^\d+(\.\d+)?$/.test(dRaw)
              ? Number(dRaw)
              : undefined;
        const urlFromJson = firstNonEmptyString(
          j.audioUrl,
          j.audio_url,
          j.url,
          j.mediaUrl,
          j.media_url,
          j.fileUrl,
          j.attachmentUrl,
          j.attachment_url,
          j.path,
          j.location,
          j.filePath
        );
        if (urlFromJson || topMediaEarly) {
          voiceFromJson = {
            audioUrl: urlFromJson,
            durationSec: dNum,
          };
        }
      }
    } catch {
      /* plain text */
    }
  }
  const readAtRaw = v.readAt ?? v.read_at ?? v.seenAt ?? v.seen_at;
  const readAt =
    typeof readAtRaw === "string" && readAtRaw.length > 0 ? readAtRaw : undefined;
  const seenRaw = v.seen ?? v.read ?? v.isRead ?? v.readFlag;
  /** Do not infer from `readAt` — many APIs use it for unrelated state and caused false "seen" ticks. */
  const seen =
    typeof seenRaw === "boolean"
      ? seenRaw
      : typeof seenRaw === "string"
        ? seenRaw.toLowerCase() === "true"
        : false;
  const readBy = parseReadByList(
    v.readBy ?? v.read_by ?? v.readReceipts ?? v.readReceipt ?? v.seenBy
  );
  const editedAtRaw = v.editedAt ?? v.edited_at ?? v.updatedAt ?? v.modifiedAt;
  const editedAt =
    typeof editedAtRaw === "string" && editedAtRaw.length > 0 ? editedAtRaw : undefined;
  const mediaUrlRaw =
    firstNonEmptyString(
      voiceFromJson?.audioUrl,
      v.attachmentUrl,
      v.attachment_url,
      v.mediaUrl,
      v.media_url,
      v.fileUrl,
      v.file_url,
      v.url,
      v.path,
      v.filePath,
      v.location
    );
  const mediaUrl = toAbsoluteBackendUrl(mediaUrlRaw);
  const audioUrlRaw = firstNonEmptyString(v.audioUrl, v.audio_url);
  const audioUrl = audioUrlRaw ? toAbsoluteBackendUrl(audioUrlRaw) : undefined;
  const mediaTypeRaw =
    v.attachmentType ?? v.attachment_type ?? v.mediaType ?? v.media_type ?? v.fileType;
  const mediaNameRaw = v.attachmentName ?? v.attachment_name ?? v.fileName ?? v.filename;
  const mediaName =
    typeof mediaNameRaw === "string" && mediaNameRaw.trim().length > 0
      ? mediaNameRaw.trim()
      : undefined;
  const durationRaw = v.durationSec ?? v.duration ?? v.voiceDurationSec;
  const voiceDurationFromServer =
    typeof durationRaw === "number"
      ? durationRaw
      : typeof durationRaw === "string" && /^\d+(\.\d+)?$/.test(durationRaw)
        ? Number(durationRaw)
        : voiceFromJson?.durationSec;
  const mediaType:
    | "image"
    | "file"
    | "voice"
    | undefined = (() => {
    const raw = String(mediaTypeRaw ?? "").toLowerCase();
    if (raw === "voice" || raw === "audio") return "voice";
    if (raw === "image" || raw === "file") return raw;
    if (voiceFromJson != null) return "voice";
    if (mediaUrl && /\.(webm|ogg|opus|mp3|wav|m4a)$/i.test(mediaUrl)) return "voice";
    if (mediaUrl && /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(mediaUrl)) return "image";
    if (mediaUrl) return "file";
    return undefined;
  })();
  const { reactionMap, reactionUsers } = parseMessageReactionsFromDto(v);
  const myReactionRaw = v.myReaction ?? v.my_reaction ?? v.selfReaction;
  const myReaction =
    typeof myReactionRaw === "string" && myReactionRaw.trim().length > 0
      ? myReactionRaw.trim()
      : undefined;

  const contentSnippetRaw = firstNonEmptyString(
    v.contentSnippet,
    v.content_snippet,
    v.snippet,
    v.preview,
    v.textPreview,
    v.text_preview,
    v.summary
  );
  const contentSnippet =
    contentSnippetRaw && contentSnippetRaw.trim().length > 0
      ? contentSnippetRaw.trim()
      : undefined;

  if (isChatDebug()) {
    const maybeVoice =
      mediaType === "voice" ||
      voiceFromJson != null ||
      /\.(webm|ogg|opus|mp3|wav|m4a)/i.test(String(mediaUrl ?? "")) ||
      /"voice"/i.test(content.slice(0, 600));
    if (maybeVoice) {
      chatDebug("mapMessage (voice-related)", {
        id: String(v.id ?? v.messageId ?? ""),
        mediaType,
        mediaUrl,
        voiceFromJson,
        clearedContent: Boolean(voiceFromJson != null && mediaUrl),
        contentLen: content.length,
        contentHead: content.slice(0, 200),
        topMediaEarly: topMediaEarly ?? null,
        mediaUrlRaw: mediaUrlRaw ?? null,
        dtoKeys: Object.keys(v).sort(),
      });
    }
  }

  const msgTypeRaw = v.type ?? v.messageType ?? v.message_type;
  const messageType = typeof msgTypeRaw === "string" && msgTypeRaw.trim() ? msgTypeRaw.trim() : undefined;
  const parentMessageIdRaw =
    v.parentMessageId ?? v.parent_message_id ?? v.parentId ?? v.parent_id;
  const parentMessageRaw =
    v.parentMessage ??
    v.parent_message ??
    v.parent ??
    (v.replyTo && typeof v.replyTo === "object" && !Array.isArray(v.replyTo)
      ? v.replyTo
      : undefined) ??
    (v.inReplyTo && typeof v.inReplyTo === "object" && !Array.isArray(v.inReplyTo)
      ? v.inReplyTo
      : undefined) ??
    (v.in_reply_to && typeof v.in_reply_to === "object" && !Array.isArray(v.in_reply_to)
      ? v.in_reply_to
      : undefined) ??
    (v.quotedMessage && typeof v.quotedMessage === "object" && !Array.isArray(v.quotedMessage)
      ? v.quotedMessage
      : undefined) ??
    (v.quoted_message && typeof v.quoted_message === "object" && !Array.isArray(v.quoted_message)
      ? v.quoted_message
      : undefined);
  const parentMessage =
    parentMessageRaw && typeof parentMessageRaw === "object"
      ? (() => {
          const p = parentMessageRaw as Record<string, unknown>;
          const pid = p.id ?? p.messageId ?? p.message_id ?? parentMessageIdRaw;
          const psender = firstNonEmptyString(
            p.sender,
            p.senderName,
            p.sender_name,
            p.username,
            p.userName
          );
          const psnippet = firstNonEmptyString(
            p.contentSnippet,
            p.content_snippet,
            p.snippet,
            p.preview,
            p.textPreview,
            p.text_preview,
            p.summary
          );
          const pcontent = firstNonEmptyString(p.content, p.message, p.text);
          const pMediaUrlRaw = firstNonEmptyString(
            p.attachmentUrl,
            p.attachment_url,
            p.mediaUrl,
            p.media_url,
            p.fileUrl,
            p.file_url,
            p.url,
            p.path,
            p.filePath,
            p.location
          );
          const pMediaUrl = pMediaUrlRaw ? toAbsoluteBackendUrl(pMediaUrlRaw) : undefined;
          const pTypeRaw =
            p.attachmentType ?? p.attachment_type ?? p.mediaType ?? p.media_type ?? p.fileType;
          const parentMediaType: "image" | "voice" | "file" | undefined = (() => {
            const raw = String(pTypeRaw ?? "").toLowerCase();
            if (raw === "voice" || raw === "audio") return "voice";
            if (raw === "image" || raw === "file") return raw;
            if (pMediaUrl && /\.(webm|ogg|opus|mp3|wav|m4a)(\?|#|$)/i.test(pMediaUrl)) return "voice";
            if (pMediaUrl && /\.(png|jpe?g|gif|webp|bmp|svg)(\?|#|$)/i.test(pMediaUrl))
              return "image";
            if (pMediaUrl) return "file";
            return undefined;
          })();
          if (pid == null && !psender && !pcontent && !psnippet && !pMediaUrlRaw) return undefined;
          return {
            id: String(pid ?? crypto.randomUUID()),
            sender: psender ?? undefined,
            content: pcontent ?? undefined,
            contentSnippet: psnippet ?? undefined,
            mediaUrl: pMediaUrl,
            mediaType: parentMediaType,
          };
        })()
      : undefined;

  return {
    id: String(v.id ?? v.messageId ?? crypto.randomUUID()),
    roomId: String(v.roomId ?? v.chatRoomId ?? ""),
    senderId: senderId != null ? String(senderId) : undefined,
    sender: String(senderName),
    parentMessageId: parentMessageIdRaw != null ? String(parentMessageIdRaw) : parentMessage?.id,
    parentMessage,
    type: messageType,
    content: voiceFromJson != null && mediaUrl ? "" : content,
    createdAt: (() => {
      const raw = String(v.createdAt ?? v.timestamp ?? new Date().toISOString());
      return normalizeBackendTimestamp(raw) ?? raw;
    })(),
    readAt,
    seen,
    seenBy: readBy.length > 0 ? [...readBy] : undefined,
    readBy: readBy.length > 0 ? readBy : undefined,
    editedAt,
    mediaUrl,
    audioUrl: audioUrl ?? (mediaType === "voice" ? mediaUrl : undefined),
    mediaType,
    mediaName,
    voiceDurationSec:
      typeof voiceDurationFromServer === "number" && !Number.isNaN(voiceDurationFromServer)
        ? voiceDurationFromServer
        : undefined,
    reactions: Object.keys(reactionMap).length > 0 ? reactionMap : undefined,
    reactionSummary:
      "reactionSummary" in v || "reaction_summary" in v ? { ...reactionMap } : undefined,
    reactionUsers: Object.keys(reactionUsers).length > 0 ? reactionUsers : undefined,
    myReaction,
  };
};

/**
 * Fills `parentMessage` when the API only sent `parentMessageId` but the parent row exists
 * in the same message list (typical room history).
 */
export function enrichMessagesWithReplyParents(messages: ChatMessage[]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const m of messages) {
    byId.set(String(m.id), m);
  }
  return messages.map((m) => {
    if (m.parentMessage != null) return m;
    const pid = m.parentMessageId?.trim();
    if (!pid) return m;
    const p = byId.get(pid);
    if (!p) return m;
    return {
      ...m,
      parentMessage: {
        id: String(p.id),
        sender: p.sender,
        content: p.content,
        contentSnippet: p.contentSnippet,
        mediaUrl: p.mediaUrl,
        mediaType: p.mediaType,
      },
    };
  });
}

export const normalizeMessageBody = (value: unknown): ChatMessage => mapMessage(value);

const unwrapList = (value: unknown, keys: string[]): unknown[] => {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  const v = value as Record<string, unknown>;
  let firstEmpty: unknown[] | null = null;
  for (const key of keys) {
    const arr = v[key];
    if (!Array.isArray(arr)) continue;
    if (arr.length > 0) return arr;
    if (firstEmpty === null) firstEmpty = arr;
  }
  return firstEmpty ?? [];
};

const mapUserSummary = (value: unknown): UserSummary | null => {
  const v = (value ?? {}) as Record<string, unknown>;
  const idRaw = v.id ?? v.userId ?? v.user_id;
  const username =
    firstNonEmptyString(
      v.username,
      v.userName,
      v.user_name,
      v.login,
      v.name,
      v.email
    ) ?? null;
  if (idRaw == null || !username) return null;
  const displayName =
    firstNonEmptyString(
      v.displayName,
      v.display_name,
      v.fullName,
      v.full_name,
      v.nickname,
      v.nickName,
      v.name
    ) ?? null;
  const onlineVal =
    v.online ?? v.isOnline ?? v.is_online ?? v.onlineStatus ?? v.online_status ?? v.status;
  let online: boolean | undefined;
  if (typeof onlineVal === "boolean") online = onlineVal;
  else if (typeof onlineVal === "string") {
    const s = onlineVal.toLowerCase();
    online = s.includes("online") || s === "true";
  }
  const avatarRaw = firstNonEmptyString(
    v.avatarUrl,
    v.avatar_url,
    v.profileImageUrl,
    v.profile_image_url,
    v.imageUrl,
    v.image_url,
    v.photoUrl,
    v.photo_url
  );
  const avatarUrl = avatarRaw ? (toAbsoluteBackendUrl(avatarRaw) ?? avatarRaw) : null;
  const bioRaw = firstNonEmptyString(v.bio, v.about, v.description);
  const lastSeenRaw = firstNonEmptyString(
    v.lastSeenAt,
    v.last_seen_at,
    v.lastSeen,
    v.last_seen
  );
  return {
    id: String(idRaw),
    username: username.trim(),
    displayName,
    avatarUrl,
    online,
    bio: bioRaw ?? null,
    lastSeenAt: lastSeenRaw ?? null,
  };
};

/**
 * Flatten a tree of comments returned by the backend (each parent has nested
 * `replies: [...]`) into the flat list `CommentSection` expects, setting
 * `parentCommentId` on descendants when the server omitted it.
 */
export function flattenPostComments(values: unknown): PostComment[] {
  const out: PostComment[] = [];
  const walk = (raw: unknown, inheritedParentId: string | undefined): void => {
    if (!raw || typeof raw !== "object") return;
    const v = raw as Record<string, unknown>;
    const mapped = mapPostComment(v);
    if (!mapped.parentCommentId && inheritedParentId) {
      mapped.parentCommentId = inheritedParentId;
    }
    out.push(mapped);
    const repliesRaw = v.replies ?? v.children ?? v.childComments ?? v.child_comments;
    if (Array.isArray(repliesRaw)) {
      for (const r of repliesRaw) walk(r, mapped.id);
    }
  };
  if (Array.isArray(values)) {
    for (const v of values) walk(v, undefined);
  }
  return out;
}

/** Normalize a single comment from list or `POST .../comments` response. */
export function mapPostComment(value: unknown): PostComment {
  const v = (value ?? {}) as Record<string, unknown>;
  const userObj = v.user && typeof v.user === "object" ? (v.user as Record<string, unknown>) : null;
  const authorObj =
    v.author && typeof v.author === "object" ? (v.author as Record<string, unknown>) : null;
  const a = authorObj ?? userObj;
  const displayName =
    firstNonEmptyString(
      v.displayName,
      v.display_name,
      v.authorName,
      v.author_name,
      v.username,
      v.userName,
      v.name,
      typeof a?.displayName === "string" ? a.displayName : undefined,
      typeof a?.display_name === "string" ? a.display_name : undefined,
      typeof a?.username === "string" ? a.username : undefined,
      typeof a?.name === "string" ? a.name : undefined
    ) ?? "Member";
  const avatarRaw = firstNonEmptyString(
    v.avatarUrl,
    v.avatar_url,
    v.profileImageUrl,
    typeof a?.avatarUrl === "string" ? a.avatarUrl : undefined,
    typeof a?.avatar_url === "string" ? a.avatar_url : undefined,
    typeof a?.profileImageUrl === "string" ? a.profileImageUrl : undefined
  );
  const avatarUrl = avatarRaw ? (toAbsoluteBackendUrl(avatarRaw) ?? avatarRaw) : null;
  const content = firstNonEmptyString(v.content, v.text, v.body, v.message) ?? "";
  const idRaw = v.id ?? v.commentId ?? v.comment_id;
  const authorIdRaw =
    v.authorId ??
    v.author_id ??
    v.userId ??
    v.user_id ??
    v.commenterId ??
    v.commenter_id ??
    v.memberId ??
    v.member_id ??
    v.createdBy ??
    v.created_by ??
    v.createdById ??
    v.created_by_id ??
    v.ownerId ??
    v.owner_id ??
    (typeof a?.id !== "undefined" ? a.id : undefined) ??
    (typeof a?.userId !== "undefined" ? a.userId : undefined) ??
    (typeof a?.user_id !== "undefined" ? a.user_id : undefined);
  const createdAtRaw = firstNonEmptyString(v.createdAt, v.created_at, v.timestamp);
  const createdAt = createdAtRaw
    ? (normalizeBackendTimestamp(createdAtRaw) ?? createdAtRaw)
    : undefined;
  const parentRaw =
    v.parentCommentId ??
    v.parent_comment_id ??
    v.parentCommentID ??
    v.parentId ??
    v.parent_id ??
    v.commentParentId ??
    v.comment_parent_id ??
    v.replyToCommentId ??
    v.reply_to_comment_id ??
    v.replyToId ??
    v.reply_to_id ??
    v.inReplyTo ??
    v.in_reply_to ??
    (v.parentComment && typeof v.parentComment === "object"
      ? (v.parentComment as Record<string, unknown>).id
      : undefined) ??
    (v.parent_comment && typeof v.parent_comment === "object"
      ? (v.parent_comment as Record<string, unknown>).id
      : undefined) ??
    (v.parent && typeof v.parent === "object"
      ? (v.parent as Record<string, unknown>).id
      : undefined);
  return {
    id: idRaw != null ? String(idRaw) : crypto.randomUUID(),
    content,
    createdAt: createdAt ?? undefined,
    displayName,
    avatarUrl,
    parentCommentId: parentRaw != null ? String(parentRaw) : undefined,
    authorId: authorIdRaw != null ? String(authorIdRaw) : undefined,
  };
}

function mapReactionSummaryFromDto(v: Record<string, unknown>): Record<string, number> | undefined {
  const raw = v.reactionSummary ?? v.reaction_summary;
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, number> = {};
  for (const [k, val] of Object.entries(raw as Record<string, unknown>)) {
    const key = k.trim();
    if (!key) continue;
    const n =
      typeof val === "number" && Number.isFinite(val)
        ? val
        : typeof val === "string" && /^\d+$/.test(val.trim())
          ? Number(val.trim())
          : 0;
    if (n > 0) out[key] = n;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

const mapUserPost = (value: unknown): UserPost => {
  const v = (value ?? {}) as Record<string, unknown>;
  const idRaw = v.id ?? v.postId ?? v.post_id;
  const titleOnly = firstNonEmptyString(v.title, v.headline, v.subject);
  const content =
    firstNonEmptyString(v.content, v.text, v.body, v.message, v.description) ?? titleOnly ?? "";
  const createdAt = firstNonEmptyString(
    v.createdAt,
    v.created_at,
    v.timestamp,
    v.postedAt,
    v.posted_at
  );
  const mediaRaw = firstNonEmptyString(
    v.imageUrl,
    v.image_url,
    v.mediaUrl,
    v.media_url,
    v.attachmentUrl,
    v.attachment_url,
    v.url
  );
  const mediaUrl = mediaRaw ? (toAbsoluteBackendUrl(mediaRaw) ?? mediaRaw) : undefined;
  const reactionRaw = v.reactionCount ?? v.reactionsCount ?? v.likesCount ?? v.likeCount;
  const reactionCount =
    typeof reactionRaw === "number"
      ? reactionRaw
      : typeof reactionRaw === "string" && /^\d+$/.test(reactionRaw)
        ? Number(reactionRaw)
        : undefined;
  const reactionSummary = mapReactionSummaryFromDto(v);
  const reactionCountFromSummary =
    reactionSummary && (reactionCount == null || !Number.isFinite(reactionCount))
      ? Object.values(reactionSummary).reduce((a, b) => a + b, 0)
      : undefined;
  const commentRaw = v.commentCount ?? v.commentsCount ?? v.comment_count;
  const commentCount =
    typeof commentRaw === "number"
      ? commentRaw
      : typeof commentRaw === "string" && /^\d+$/.test(commentRaw)
        ? Number(commentRaw)
        : undefined;
  const myReactionRaw = v.myReaction ?? v.my_reaction ?? v.userReaction ?? v.user_reaction;
  const myReaction =
    typeof myReactionRaw === "string" && myReactionRaw.trim() ? myReactionRaw.trim() : null;
  const commentsListRaw = v.comments ?? v.commentList ?? v.comment_list;
  const comments = Array.isArray(commentsListRaw)
    ? commentsListRaw.map(mapPostComment)
    : undefined;
  return {
    id: idRaw != null ? String(idRaw) : crypto.randomUUID(),
    title: titleOnly ?? undefined,
    content,
    createdAt: createdAt ?? undefined,
    mediaUrl,
    reactionCount: reactionCount ?? reactionCountFromSummary,
    reactionSummary,
    commentCount,
    myReaction: myReaction ?? undefined,
    comments: comments && comments.length > 0 ? comments : undefined,
  };
};

/** Spring `PUT /api/user/profile/update` may return `{ user: {...} }` or `{ data: {...} }`. */
function unwrapUserProfilePutPayload(v: Record<string, unknown>): Record<string, unknown> {
  for (const k of ["user", "data", "profile", "body", "result", "payload"] as const) {
    const inner = v[k];
    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
      return inner as Record<string, unknown>;
    }
  }
  return v;
}

function mapMyUserProfileFromJson(v: Record<string, unknown>): MyUserProfile {
  const idRaw = v.id ?? v.userId ?? v.user_id;
  const username =
    firstNonEmptyString(v.username, v.userName, v.user_name, v.name, v.email) ?? null;
  const displayName =
    firstNonEmptyString(
      v.displayName,
      v.display_name,
      v.fullName,
      v.full_name,
      v.nickname,
      v.nickName
    ) ?? username;
  const avatarRaw = firstNonEmptyString(
    v.avatarUrl,
    v.avatar_url,
    v.profileImageUrl,
    v.profile_image_url,
    v.imageUrl,
    v.image_url,
    v.photoUrl,
    v.photo_url
  );
  const avatarUrl = avatarRaw ? (toAbsoluteBackendUrl(avatarRaw) ?? avatarRaw) : null;
  const coverRaw = firstNonEmptyString(
    v.coverPhotoUrl,
    v.cover_photo_url,
    v.coverImage,
    v.cover_image,
    v.coverUrl,
    v.cover_url,
    v.bannerUrl,
    v.banner_url
  );
  const coverPhotoUrl = coverRaw ? (toAbsoluteBackendUrl(coverRaw) ?? coverRaw) : null;
  const themeRaw = String(v.theme ?? v.colorScheme ?? v.appearance ?? "").toLowerCase();
  const theme: "light" | "dark" = themeRaw === "dark" ? "dark" : "light";
  const bio =
    firstNonEmptyString(v.bio, v.about, v.description, v.userBio, v.user_bio) ?? null;
  return {
    id: idRaw != null ? String(idRaw) : null,
    username,
    displayName,
    avatarUrl,
    coverPhotoUrl,
    bio,
    theme,
  };
}

function mapMyProfileFromUserProfilePutBody(bodyText: string): MyUserProfile | null {
  if (!bodyText.trim()) return null;
  try {
    const data = JSON.parse(bodyText) as Record<string, unknown>;
    if (data && typeof data === "object" && !Array.isArray(data)) {
      return mapMyUserProfileFromJson(unwrapUserProfilePutPayload(data));
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Ids of users involved in a friendship row (flat + nested Spring DTOs). */
function friendshipRowUserIds(v: Record<string, unknown>): string[] {
  const out: string[] = [];
  const push = (x: unknown): void => {
    if (x == null) return;
    const s = String(x).trim();
    if (s) out.push(s);
  };
  push(v.requesterId);
  push(v.requester_id);
  push(v.receiverId);
  push(v.receiver_id);
  push(v.senderId);
  push(v.fromUserId);
  push(v.toUserId);
  push(v.userId);
  push(v.friendId);
  push(v.targetUserId);
  push(v.user1Id);
  push(v.user2Id);
  const nestedId = (key: string): void => {
    const n = v[key];
    if (n && typeof n === "object" && !Array.isArray(n)) {
      const u = n as Record<string, unknown>;
      push(u.id ?? u.userId ?? u.user_id);
    }
  };
  nestedId("requester");
  nestedId("receiver");
  nestedId("sender");
  nestedId("friend");
  nestedId("user");
  nestedId("otherUser");
  return Array.from(new Set(out));
}

function friendshipRowLooksExplicitlyPending(v: Record<string, unknown>): boolean {
  const s = String(
    v.status ?? v.state ?? v.friendshipStatus ?? v.requestStatus ?? v.relationshipStatus ?? ""
  )
    .trim()
    .toUpperCase();
  return (
    s.includes("PENDING") ||
    s.includes("REQUESTED") ||
    s.includes("WAITING") ||
    s === "SENT" ||
    s === "OUTGOING" ||
    s === "RECEIVED" ||
    s === "INCOMING"
  );
}

/** Who sent vs who received (Spring `requesterId` / `receiverId` or nested `requester` / `receiver`). */
function friendshipRowDirectedParties(v: Record<string, unknown>): {
  requesterId: string | null;
  receiverId: string | null;
} {
  const pick = (x: unknown): string | null => {
    if (x == null) return null;
    const s = String(x).trim();
    return s.length > 0 ? s : null;
  };
  let requesterId =
    pick(v.requesterId) ??
    pick(v.requester_id) ??
    pick(v.senderId) ??
    pick(v.fromUserId) ??
    pick(v.initiatorId) ??
    pick(v.requesterUserId);
  let receiverId =
    pick(v.receiverId) ??
    pick(v.receiver_id) ??
    pick(v.addresseeId) ??
    pick(v.toUserId) ??
    pick(v.targetUserId) ??
    pick(v.recipientId);

  const rNest = v.requester ?? v.sender ?? v.fromUser;
  if (!requesterId && rNest && typeof rNest === "object" && !Array.isArray(rNest)) {
    const u = rNest as Record<string, unknown>;
    requesterId = pick(u.id ?? u.userId ?? u.user_id);
  }
  const recNest = v.receiver ?? v.addressee ?? v.toUser ?? v.recipient;
  if (!receiverId && recNest && typeof recNest === "object" && !Array.isArray(recNest)) {
    const u = recNest as Record<string, unknown>;
    receiverId = pick(u.id ?? u.userId ?? u.user_id);
  }

  if (!requesterId && !receiverId) {
    const uidFlat = pick(v.userId);
    const fidFlat = pick(v.friendId);
    if (uidFlat && fidFlat) {
      requesterId = uidFlat;
      receiverId = fidFlat;
    }
  }
  return { requesterId, receiverId };
}

/**
 * Resolve friendship UI for `peerUserId` using the signed-in `viewerUserId` so PENDING means
 * "I sent" vs "they sent" (RECEIVED) when the API only sends generic PENDING + requester/receiver.
 */
function parseFriendshipSnapshotForPeer(
  row: unknown,
  viewerUserId: string | null | undefined,
  peerUserId: string
): FriendshipSnapshot {
  if (!row || typeof row !== "object") return { status: null };
  const v = row as Record<string, unknown>;
  const me = viewerUserId != null ? String(viewerUserId).trim() : "";
  const peer = String(peerUserId).trim();

  const base = parseFriendshipBody(row);
  if (base.status === "ACCEPTED") return base;
  /** API already distinguished incoming vs outgoing — do not override with heuristics. */
  if (base.status === "RECEIVED") return base;

  const { requesterId, receiverId } = friendshipRowDirectedParties(v);
  const pendingish =
    base.status === "PENDING" ||
    (base.status === null && friendshipRowLooksExplicitlyPending(v));

  const rid = base.requestId;
  const eq = (a: string | null, b: string) => Boolean(a && b && String(a) === String(b));

  if (me && peer && requesterId && receiverId && pendingish) {
    if (eq(requesterId, me) && eq(receiverId, peer)) {
      return { status: "PENDING", requestId: rid };
    }
    if (eq(requesterId, peer) && eq(receiverId, me)) {
      return { status: "RECEIVED", requestId: rid };
    }
  }

  if (me && peer && pendingish && requesterId && !receiverId) {
    if (eq(requesterId, peer)) return { status: "RECEIVED", requestId: rid };
    if (eq(requesterId, me)) return { status: "PENDING", requestId: rid };
  }

  if (me && peer && pendingish && !requesterId && receiverId) {
    if (eq(receiverId, me)) return { status: "RECEIVED", requestId: rid };
    if (eq(receiverId, peer)) return { status: "PENDING", requestId: rid };
  }

  if (me && peer && pendingish && !requesterId && !receiverId) {
    const pick = (x: unknown): string | null => {
      if (x == null) return null;
      const s = String(x).trim();
      return s.length > 0 ? s : null;
    };
    const initiatorId =
      pick(v.initiatedByUserId) ??
      pick(v.initiatorId) ??
      pick(v.initiatedBy) ??
      pick(v.createdById) ??
      pick(v.createdByUserId);
    if (initiatorId) {
      if (eq(initiatorId, me)) return { status: "PENDING", requestId: rid };
      if (eq(initiatorId, peer)) return { status: "RECEIVED", requestId: rid };
    }
  }

  if (base.status === "PENDING") return base;

  const statusStr = String(
    v.status ?? v.state ?? v.friendshipStatus ?? v.requestStatus ?? v.relationshipStatus ?? ""
  )
    .trim()
    .toUpperCase();
  if (statusStr.includes("REJECT") || statusStr.includes("DECLINE")) {
    return { status: null };
  }
  if (!friendshipRowLooksExplicitlyPending(v)) {
    return { status: "ACCEPTED" };
  }
  return { status: null };
}

/** Normalize friendship DTOs from common Spring shapes. */
function parseFriendshipBody(v: unknown): FriendshipSnapshot {
  if (!v || typeof v !== "object") return { status: null };
  const o = v as Record<string, unknown>;
  const inner =
    o.data && typeof o.data === "object" && !Array.isArray(o.data)
      ? (o.data as Record<string, unknown>)
      : o.friendship && typeof o.friendship === "object"
        ? (o.friendship as Record<string, unknown>)
        : null;
  const src = inner ?? o;

  const acceptedFlag = src.accepted ?? src.confirmed ?? o.accepted ?? o.confirmed;
  if (acceptedFlag === true) {
    return { status: "ACCEPTED" };
  }
  const acceptedAt = firstNonEmptyString(
    src.acceptedAt,
    src.accepted_at,
    src.friendsSince,
    src.friends_since
  );
  if (acceptedAt) {
    return { status: "ACCEPTED" };
  }

  const statusRaw = String(
    src.status ??
      src.state ??
      src.friendshipStatus ??
      src.requestStatus ??
      src.relationshipStatus ??
      o.status ??
      ""
  )
    .trim()
    .toUpperCase();
  const idRaw =
    src.requestId ??
    src.friendRequestId ??
    src.id ??
    src.request_id ??
    o.requestId ??
    o.friendRequestId;
  const requestId =
    idRaw != null && String(idRaw).trim().length > 0 ? String(idRaw).trim() : undefined;
  const incoming = Boolean(
    src.incoming ?? src.received ?? src.isIncoming ?? src.incomingRequest ?? o.incoming
  );

  if (
    statusRaw === "ACCEPTED" ||
    statusRaw === "FRIEND" ||
    statusRaw === "FRIENDS" ||
    statusRaw === "ACTIVE" ||
    statusRaw === "APPROVED" ||
    statusRaw === "CONFIRMED" ||
    statusRaw === "COMPLETED"
  ) {
    return { status: "ACCEPTED" };
  }
  if (statusRaw === "RECEIVED" || statusRaw === "INCOMING") {
    return { status: "RECEIVED", requestId };
  }
  if (statusRaw === "OUTGOING" || statusRaw === "SENT") {
    return { status: "PENDING", requestId };
  }
  if (statusRaw === "PENDING" || statusRaw === "REQUESTED" || statusRaw === "WAITING") {
    return incoming ? { status: "RECEIVED", requestId } : { status: "PENDING", requestId };
  }
  if (statusRaw === "NONE" || statusRaw === "REJECTED" || statusRaw === "DECLINED") {
    return { status: null };
  }
  return { status: null };
}

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

  async register(username: string, email: string, password: string): Promise<void> {
    await webApi.post("/api/auth/register", {
      username: username.trim(),
      email: email.trim(),
      password,
    });
  },

  /** POST /api/auth/forgot-password (Next proxy) — backend sends OTP to email (`{ email }`). */
  async requestPasswordReset(email: string): Promise<void> {
    await webApi.post("/api/auth/forgot-password", {
      email: email.trim(),
    });
  },
  

  /** POST /api/auth/verify-otp (Next proxy) — optional check, does not consume OTP. */
  async verifyPasswordResetOtp(email: string, otp: string): Promise<void> {
    await webApi.post("/api/auth/verify-otp", {
      email: email.trim(),
      otp: otp.trim(),
    });
  },

  /**
   * POST /api/auth/reset-password (Next proxy) — consumes OTP and updates password.
   * Body: `{ email, otp, newPassword }`
   */
  async resetPasswordWithOtp(
    email: string,
    otp: string,
    newPassword: string
  ): Promise<void> {
    await webApi.post("/api/auth/reset-password", {
      email: email.trim(),
      otp: otp.trim(),
      newPassword,
    });
  },

  /** Legacy token-based reset flow (`/reset-password?token=...`). */
  async resetPasswordWithToken(token: string, newPassword: string): Promise<void> {
    await webApi.post("/api/auth/reset-password", {
      token: token.trim(),
      newPassword,
    });
  },

  /** PUT /api/auth/change-password (Next proxy) — requires JWT; backend should verify current password with BCrypt. */
  async changePassword(
    token: string,
    currentPassword: string,
    newPassword: string
  ): Promise<void> {
    await webApi.put(
      "/api/auth/change-password",
      { currentPassword, newPassword },
      { headers: authHeaders(token) }
    );
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

  mapMyUserProfileFromDto(v: Record<string, unknown>): MyUserProfile {
    return mapMyUserProfileFromJson(v);
  },

  async getMyProfile(token: string): Promise<MyUserProfile> {
    const response = await backendApi.get("/api/users/me", {
      headers: authHeaders(token),
    });
    return chatApi.mapMyUserProfileFromDto((response.data ?? {}) as Record<string, unknown>);
  },

  /**
   * Updates the signed-in user via `PUT /api/users/me`.
   * Sends only fields you pass. Avoid `username` unless your API allows it.
   */
  async updateMyProfile(
    token: string,
    payload: {
      displayName?: string;
      avatarUrl?: string;
      theme?: "light" | "dark";
      /** Omit to leave unchanged; pass "" or null to clear if the API supports it. */
      bio?: string | null;
      coverPhotoUrl?: string | null;
    }
  ): Promise<MyUserProfile> {
    const body: Record<string, unknown> = {};
    if (payload.displayName != null && String(payload.displayName).trim() !== "") {
      body.displayName = String(payload.displayName).trim();
    }
    if (payload.avatarUrl != null && String(payload.avatarUrl).trim() !== "") {
      body.avatarUrl = String(payload.avatarUrl).trim();
    }
    if (payload.theme === "light" || payload.theme === "dark") {
      body.theme = payload.theme;
    }
    if (payload.bio !== undefined) {
      body.bio = payload.bio == null ? "" : String(payload.bio);
    }
    if (payload.coverPhotoUrl !== undefined) {
      const c = payload.coverPhotoUrl;
      if (c == null || String(c).trim() === "") {
        body.coverPhotoUrl = null;
      } else {
        body.coverPhotoUrl = String(c).trim();
      }
    }
    if (Object.keys(body).length === 0) {
      throw new Error("Nothing to update.");
    }
    const response = await backendApi.put("/api/users/me", body, {
      headers: authHeaders(token),
    });
    const d = response.data;
    if (d && typeof d === "object" && Object.keys(d as object).length > 0) {
      return mapMyUserProfileFromJson(d as Record<string, unknown>);
    }
    const again = await backendApi.get("/api/users/me", { headers: authHeaders(token) });
    return mapMyUserProfileFromJson((again.data ?? {}) as Record<string, unknown>);
  },

  /**
   * User profile controller: `PUT /api/user/profile/update`
   * `multipart/form-data`: `bio`, `theme`, optional `displayName`, and `coverImage` (file, URL string, or empty to clear).
   */
  async updateUserProfileCover(
    token: string,
    opts: {
      bio: string;
      theme: string;
      coverImageUrl?: string | null;
      file?: File;
      displayName?: string;
    }
  ): Promise<MyUserProfile> {
    const coverPayload: string | File =
      opts.file ??
      (opts.coverImageUrl != null && String(opts.coverImageUrl).trim() !== ""
        ? String(opts.coverImageUrl).trim()
        : "");
    const { ok, status, bodyText } = await putUserProfileCoverUpdate(CHAT_BACKEND_ORIGIN, token, {
      bio: opts.bio ?? "",
      theme: opts.theme ?? "light",
      coverImage: coverPayload,
      displayName: opts.displayName,
    });
    if (!ok) {
      throw new Error(bodyText.trim() || `Profile cover update failed (${status})`);
    }
    const mapped = mapMyProfileFromUserProfilePutBody(bodyText);
    if (mapped) return mapped;
    return chatApi.getMyProfile(token);
  },

  /**
   * Settings save when the user picked a new cover: one `PUT` with `FormData` (`bio`, `theme`, `displayName`, `coverImage` file).
   * Does not set `Content-Type` (browser sets multipart boundary).
   */
  async saveProfileCoverWithUpload(
    token: string,
    fields: { displayName: string; bio: string; theme: "light" | "dark"; file: File }
  ): Promise<MyUserProfile> {
    const { ok, status, bodyText } = await putUserProfileCoverUpdate(CHAT_BACKEND_ORIGIN, token, {
      bio: fields.bio,
      theme: fields.theme,
      coverImage: fields.file,
      displayName: fields.displayName,
    });
    if (!ok) {
      throw new Error(bodyText.trim() || `Profile update failed (${status})`);
    }
    const mapped = mapMyProfileFromUserProfilePutBody(bodyText);
    if (mapped) return mapped;
    return chatApi.getMyProfile(token);
  },

  /** Upload a profile image via `POST /api/uploads` (same as other media). Returns absolute URL. */
  async uploadProfileImageWithFetch(token: string, file: File): Promise<string> {
    const form = new FormData();
    form.append("file", file, file.name || "profile.jpg");
    const res = await fetch(resolveChatBackendFetchUrl(CHAT_BACKEND_ORIGIN, "/api/uploads"), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    if (!res.ok) {
      throw new Error(`Profile image upload failed (${res.status})`);
    }
    const uploadBody = (await res.json()) as Record<string, unknown>;
    const uploadedUrl = extractUploadUrlFromResponse(uploadBody);
    if (!uploadedUrl) throw new Error("Profile upload: missing URL in response");
    return toAbsoluteBackendUrl(uploadedUrl) ?? uploadedUrl;
  },

  async getUsersList(token: string): Promise<UserSummary[]> {
    const response = await backendApi.get("/api/users", { headers: authHeaders(token) });
    const rows = unwrapList(response.data, [
      "content",
      "data",
      "users",
      "members",
      "results",
      "items",
    ]);
    return rows
      .map(mapUserSummary)
      .filter((u): u is UserSummary => u !== null);
  },

  /** UserController: `GET /api/users/profile/{username}` */
  async getUserProfileByUsername(token: string, username: string): Promise<UserSummary | null> {
    try {
      const response = await backendApi.get(
        `/api/users/profile/${encodeURIComponent(username.trim())}`,
        { headers: authHeaders(token) }
      );
      const data = response.data;
      if (!data || typeof data !== "object") return null;
      const v = data as Record<string, unknown>;
      const inner = v.data ?? v.user ?? v.profile;
      return mapUserSummary(inner ?? data);
    } catch (e) {
      if (axios.isAxiosError(e) && e.response?.status === 404) return null;
      throw e;
    }
  },

  /** UserController: `GET /api/users/{id}` */
  async getUserById(token: string, userId: string): Promise<UserSummary | null> {
    try {
      const response = await backendApi.get(`/api/users/${encodeURIComponent(userId)}`, {
        headers: authHeaders(token),
      });
      const data = response.data;
      if (!data || typeof data !== "object") return null;
      const v = data as Record<string, unknown>;
      const inner = v.data ?? v.user ?? v.profile;
      return mapUserSummary(inner ?? data);
    } catch (e) {
      if (axios.isAxiosError(e) && e.response?.status === 404) return null;
      throw e;
    }
  },

  /** PostController: `GET /api/posts/user/{userId}` */
  async getPostsByUserId(token: string, userId: string): Promise<UserPost[]> {
    try {
      const response = await backendApi.get(`/api/posts/user/${encodeURIComponent(userId)}`, {
        headers: authHeaders(token),
      });
      return unwrapList(response.data, ["posts", "content", "data", "results", "items"]).map(
        mapUserPost
      );
    } catch (e) {
      if (axios.isAxiosError(e) && (e.response?.status === 404 || e.response?.status === 403)) {
        return [];
      }
      throw e;
    }
  },

  /** PostController: `GET /api/posts/{postId}/comments` */
  async getPostComments(token: string, postId: string): Promise<PostComment[]> {
    try {
      const response = await backendApi.get(
        `/api/posts/${encodeURIComponent(postId)}/comments`,
        { headers: authHeaders(token) }
      );
      return flattenPostComments(
        unwrapList(response.data, ["comments", "content", "data", "results", "items"])
      );
    } catch (e) {
      if (axios.isAxiosError(e) && (e.response?.status === 404 || e.response?.status === 403)) {
        return [];
      }
      throw e;
    }
  },

  /** PostController: `GET /api/posts/me` */
  async getMyPosts(token: string): Promise<UserPost[]> {
    const response = await backendApi.get("/api/posts/me", { headers: authHeaders(token) });
    return unwrapList(response.data, ["posts", "content", "data", "results", "items"]).map(
      mapUserPost
    );
  },

  /** PostController: `POST /api/posts` */
  async createPost(
    token: string,
    body: { content: string; title?: string; mediaUrl?: string }
  ): Promise<UserPost> {
    const response = await backendApi.post("/api/posts", body, { headers: authHeaders(token) });
    const raw = response.data;
    const v = (raw ?? {}) as Record<string, unknown>;
    const inner = v.data ?? v.post;
    return mapUserPost(
      inner && typeof inner === "object" ? inner : raw
    );
  },

  /** PostController: `PUT /api/posts/{id}` */
  async updatePost(
    token: string,
    postId: string,
    body: { content?: string; title?: string; mediaUrl?: string | null }
  ): Promise<UserPost> {
    const response = await backendApi.put(
      `/api/posts/${encodeURIComponent(postId)}`,
      body,
      { headers: authHeaders(token) }
    );
    const raw = response.data;
    const v = (raw ?? {}) as Record<string, unknown>;
    const inner = v.data ?? v.post;
    return mapUserPost(inner && typeof inner === "object" ? inner : raw);
  },

  /** PostController: `DELETE /api/posts/{id}` */
  async deletePost(token: string, postId: string): Promise<void> {
    await backendApi.delete(`/api/posts/${encodeURIComponent(postId)}`, {
      headers: authHeaders(token),
    });
  },

  /**
   * `POST /api/posts/{id}/react` — path `id` (int64 post id); body `{ "emoji": string }`.
   * Response may include `reactionCount`, `myReaction`, or nested `post` / `data`.
   */
  async reactToPost(
    token: string,
    postId: string,
    emoji: string
  ): Promise<{ reactionCount: number; myReaction: string | null; reactionSummary?: Record<string, number> }> {
    const response = await backendApi.post(
      `/api/posts/${encodeURIComponent(String(postId).trim())}/react`,
      { emoji: emoji.trim() },
      { headers: authHeaders(token) }
    );
    const raw = (response.data ?? {}) as Record<string, unknown>;
    const inner =
      raw.post && typeof raw.post === "object"
        ? (raw.post as Record<string, unknown>)
        : raw.data && typeof raw.data === "object"
          ? (raw.data as Record<string, unknown>)
          : raw;
    const mapped = mapUserPost(inner);
    const fromInner = Number(inner.reactionCount ?? inner.reactionsCount ?? inner.count ?? inner.likesCount);
    const reactionCount = Number.isFinite(fromInner)
      ? fromInner
      : typeof mapped.reactionCount === "number"
        ? mapped.reactionCount
        : 0;
    const mrRaw = inner.myReaction ?? inner.my_reaction ?? raw.myReaction ?? mapped.myReaction;
    const myReaction =
      typeof mrRaw === "string" && mrRaw.trim()
        ? mrRaw.trim()
        : typeof mapped.myReaction === "string" && mapped.myReaction.trim()
          ? mapped.myReaction.trim()
          : emoji;
    const reactionSummary = mapReactionSummaryFromDto(inner) ?? mapReactionSummaryFromDto(raw);
    return {
      reactionCount,
      myReaction: myReaction || null,
      ...(mapped.reactionSummary
        ? { reactionSummary: mapped.reactionSummary }
        : reactionSummary
          ? { reactionSummary }
          : {}),
    };
  },

  /**
   * `POST /api/posts/{id}/comments` — body `{ content, parentId? }`.
   * Response may include `commentCount` or nested post.
   */
  async addCommentToPost(
    token: string,
    postId: string,
    content: string,
    parentCommentId?: string
  ): Promise<{ commentCount?: number; comment?: PostComment }> {
    const parentIdNum =
      parentCommentId != null && /^\d+$/.test(String(parentCommentId).trim())
        ? Number(String(parentCommentId).trim())
        : parentCommentId;
    const response = await backendApi.post(
      `/api/posts/${encodeURIComponent(postId)}/comments`,
      parentCommentId ? { content, parentId: parentIdNum } : { content },
      { headers: authHeaders(token) }
    );
    const raw = (response.data ?? {}) as Record<string, unknown>;
    const inner =
      raw.post && typeof raw.post === "object"
        ? (raw.post as Record<string, unknown>)
        : raw.data && typeof raw.data === "object"
          ? (raw.data as Record<string, unknown>)
          : raw;
    const cc = inner.commentCount ?? inner.commentsCount ?? inner.totalComments;
    const n =
      typeof cc === "number"
        ? cc
        : typeof cc === "string" && /^\d+$/.test(cc)
          ? Number(cc)
          : undefined;
    const mapped = mapUserPost(inner);
    const fallback = mapped.commentCount;
    const commentCount =
      typeof n === "number" && Number.isFinite(n)
        ? n
        : typeof fallback === "number"
          ? fallback
          : undefined;

    const commentRaw =
      raw.comment ??
      inner.comment ??
      (typeof raw.id !== "undefined" &&
      (typeof raw.content === "string" || typeof raw.text === "string")
        ? raw
        : undefined);
    const comment =
      commentRaw && typeof commentRaw === "object" ? mapPostComment(commentRaw) : undefined;

    return { commentCount, comment };
  },

  /** `PUT /api/comments/{id}` — body `{ content }` (fallback: nested post route) */
  async updatePostComment(
    token: string,
    postId: string,
    commentId: string,
    content: string
  ): Promise<PostComment | null> {
    const mapPutBody = (raw: Record<string, unknown>): PostComment | null => {
      const inner = raw.comment ?? raw.data ?? raw;
      return inner && typeof inner === "object" ? mapPostComment(inner as Record<string, unknown>) : null;
    };
    try {
      const response = await backendApi.put(
        `/api/comments/${encodeURIComponent(commentId)}`,
        { content },
        { headers: authHeaders(token) }
      );
      const raw = (response.data ?? {}) as Record<string, unknown>;
      return mapPutBody(raw);
    } catch (e) {
      if (!axios.isAxiosError(e) || e.response?.status !== 404) throw e;
    }
    const response = await backendApi.put(
      `/api/posts/${encodeURIComponent(postId)}/comments/${encodeURIComponent(commentId)}`,
      { content },
      { headers: authHeaders(token) }
    );
    const raw = (response.data ?? {}) as Record<string, unknown>;
    return mapPutBody(raw);
  },

  /** `DELETE /api/comments/{id}` (fallback: nested post route) */
  async deletePostComment(token: string, postId: string, commentId: string): Promise<void> {
    try {
      await backendApi.delete(`/api/comments/${encodeURIComponent(commentId)}`, {
        headers: authHeaders(token),
      });
    } catch (e) {
      if (axios.isAxiosError(e) && e.response?.status === 404) {
        await backendApi.delete(
          `/api/posts/${encodeURIComponent(postId)}/comments/${encodeURIComponent(commentId)}`,
          { headers: authHeaders(token) }
        );
        return;
      }
      throw e;
    }
  },

  /** `POST /api/posts/{id}/share` — reshare to the current user’s feed. */
  async sharePostToFeed(token: string, postId: string): Promise<void> {
    await backendApi.post(
      `/api/posts/${encodeURIComponent(postId)}/share`,
      {},
      { headers: authHeaders(token) }
    );
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
      v.chatRoomId ??
      (v.room as Record<string, unknown> | undefined)?.id ??
      (v.chat as Record<string, unknown> | undefined)?.id;
    return roomId != null ? String(roomId) : null;
  },

  /**
   * ChatRoomController: `GET /api/rooms/{roomId}/history`
   * Each element is passed through {@link mapMessage}, which reads nested reply DTOs when present
   * (`parentMessage`, `parent_message`, `parent`, `replyTo`, `inReplyTo`, `quotedMessage`, …)
   * plus `parentMessageId` / `parent_message_id`. Nested parent text may be omitted; callers can
   * use {@link enrichMessagesWithReplyParents} on the returned array.
   */
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

  async sendMessage(
    token: string,
    roomId: string,
    content: string,
    parentMessageId?: string
  ): Promise<ChatMessage | null> {
    const response = await backendApi.post(
      "/api/messages",
      {
        roomId,
        content,
        parentMessageId: parentMessageId?.trim() || undefined,
        attachmentUrl: "",
        attachmentType: "",
        attachmentName: "",
      },
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
    const uploadedUrl = extractUploadUrlFromResponse(uploadBody);
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

  /**
   * Upload a voice `Blob` (e.g. `audio/webm`) with the Fetch API (`multipart/form-data`).
   * Returns an absolute URL suitable for `<audio src>` and `/api/messages`.
   */
  async uploadVoiceBlobWithFetch(
    token: string,
    blob: Blob,
    filename = "voice.webm"
  ): Promise<string> {
    const form = new FormData();
    form.append("file", blob, filename);
    const res = await fetch(resolveChatBackendFetchUrl(CHAT_BACKEND_ORIGIN, "/api/uploads"), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    if (!res.ok) {
      throw new Error(`Voice upload failed (${res.status})`);
    }
    const uploadBody = (await res.json()) as Record<string, unknown>;
    const uploadedUrl = extractUploadUrlFromResponse(uploadBody);
    if (!uploadedUrl) throw new Error("Voice upload: missing URL in response");
    return toAbsoluteBackendUrl(uploadedUrl) ?? uploadedUrl;
  },

  /** Persists a voice note (JSON content + attachment) for chat history / STOMP. */
  async sendVoiceMessage(
    token: string,
    roomId: string,
    absoluteAudioUrl: string,
    durationSec: number
  ): Promise<ChatMessage | null> {
    const content = JSON.stringify({
      type: "voice",
      audioUrl: absoluteAudioUrl,
      durationSec,
    });
    const response = await backendApi.post(
      "/api/messages",
      {
        roomId,
        content,
        attachmentUrl: absoluteAudioUrl,
        attachmentType: "voice",
        attachmentName: "voice.webm",
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

  async reactToMessage(
    token: string,
    messageId: string,
    emoji: string
  ): Promise<
    | {
        reactions?: Record<string, number>;
        reactionSummary?: Record<string, number>;
        reactionUsers?: Record<string, string[]>;
        myReaction?: string | null;
      }
    | null
  > {
    const response = await backendApi.post(
      `/api/messages/${messageId}/reactions`,
      { emoji },
      { headers: authHeaders(token) }
    );
    const data = response.data;
    if (!data || typeof data !== "object") return null;

    const v = data as Record<string, unknown>;
    const inner =
      v.message && typeof v.message === "object"
        ? (v.message as Record<string, unknown>)
        : v.data && typeof v.data === "object"
          ? (v.data as Record<string, unknown>)
          : v.result && typeof v.result === "object"
            ? (v.result as Record<string, unknown>)
            : v;

    const fromMapped = mapMessage(inner);
    const hasSummaryOnPayload =
      "reactionSummary" in inner || "reaction_summary" in inner;
    const hasMappedReactions =
      !!fromMapped.reactions ||
      !!fromMapped.reactionSummary ||
      !!fromMapped.reactionUsers ||
      typeof fromMapped.myReaction !== "undefined" ||
      hasSummaryOnPayload;
    if (hasMappedReactions) {
      return {
        reactions: fromMapped.reactions,
        reactionSummary: fromMapped.reactionSummary,
        reactionUsers: fromMapped.reactionUsers,
        myReaction: fromMapped.myReaction ?? null,
      };
    }

    const reactionsRaw = inner.reactions;
    let reactions: Record<string, number> | undefined;
    let reactionUsers: Record<string, string[]> | undefined;
    if (Array.isArray(reactionsRaw)) {
      const map: Record<string, number> = {};
      const usersMap: Record<string, string[]> = {};
      for (const item of reactionsRaw) {
        const r = (item ?? {}) as Record<string, unknown>;
        const e = typeof r.emoji === "string" ? r.emoji : null;
        if (!e) continue;
        const c =
          typeof r.count === "number"
            ? r.count
            : typeof r.total === "number"
              ? r.total
              : typeof r.count === "string" && /^\d+$/.test(r.count)
                ? Number(r.count)
                : 1;
        map[e] = c;
        const usersRaw =
          r.userIds ?? r.user_ids ?? r.users ?? r.reactors ?? r.reactedBy ?? r.reacted_by;
        if (Array.isArray(usersRaw)) {
          const users = usersRaw
            .map((u) => {
              if (typeof u === "string" || typeof u === "number") return String(u);
              if (!u || typeof u !== "object") return "";
              const uu = u as Record<string, unknown>;
              const uid = uu.id ?? uu.userId ?? uu.user_id ?? uu.username ?? uu.userName;
              return uid != null ? String(uid) : "";
            })
            .filter((v): v is string => v.trim().length > 0);
          if (users.length > 0) usersMap[e] = Array.from(new Set(users));
        }
      }
      if (Object.keys(map).length > 0) reactions = map;
      if (Object.keys(usersMap).length > 0) reactionUsers = usersMap;
    }
    const myReactionRaw = inner.myReaction ?? inner.my_reaction ?? inner.selfReaction;
    const myReaction =
      typeof myReactionRaw === "string" && myReactionRaw.trim().length > 0
        ? myReactionRaw.trim()
        : null;
    const summaryPatch = pickMessageReactionPatch(inner);
    return {
      reactions,
      reactionUsers,
      reactionSummary:
        summaryPatch.reactionSummary ?? (reactions ? { ...reactions } : undefined),
      myReaction,
    };
  },

  /**
   * Best-effort unreact for message emoji.
   * Tries common backend patterns; returns true when one succeeds.
   */
  async unreactToMessage(token: string, messageId: string, emoji: string): Promise<boolean> {
    const id = encodeURIComponent(messageId);
    const e = encodeURIComponent(emoji);
    const headers = authHeaders(token);
    const attempts: Array<() => Promise<void>> = [
      () => backendApi.delete(`/api/messages/${id}/reactions/${e}`, { headers }),
      () =>
        backendApi.delete(`/api/messages/${id}/reactions`, {
          headers,
          data: { emoji },
        }),
      () =>
        backendApi.post(
          `/api/messages/${id}/reactions/remove`,
          { emoji },
          { headers }
        ),
    ];
    for (const attempt of attempts) {
      try {
        await attempt();
        return true;
      } catch (err) {
        if (axios.isAxiosError(err) && [404, 405].includes(err.response?.status ?? -1)) {
          continue;
        }
      }
    }
    return false;
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

  /**
   * ChatRoomController: `POST /api/rooms/{roomId}/read` — mark read up to a message.
   * Body: `{ "messageId": <number> }` (JSON). Omit only when the room has no messages yet.
   */
  async markRoomAsRead(
    token: string,
    roomId: string,
    lastReadMessageId?: string | null
  ): Promise<void> {
    if (!roomReadEndpointAvailable) return;
    const id = lastReadMessageId != null ? String(lastReadMessageId).trim() : "";
    const isTemp = id.startsWith("temp-") || id.startsWith("temp-media-") || id.startsWith("temp-voice-");
    if (!id || isTemp) return;

    const asNum = Number(id);
    const looksNumeric = /^\d+$/.test(id) && Number.isFinite(asNum);
    const body = { messageId: looksNumeric ? asNum : id };

    try {
      await backendApi.post(`/api/rooms/${roomId}/read`, body, { headers: authHeaders(token) });
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const status = err.response?.status;
        if (status === 400 || status === 404 || status === 405) {
          roomReadEndpointAvailable = false;
          return;
        }
      }
      throw err;
    }
  },

  /** ChatRoomController: `GET /api/rooms/{roomId}/reads` — read receipts keyed by message id (or wrapped). */
  async getRoomReads(token: string, roomId: string): Promise<Record<string, string[]>> {
    const response = await backendApi.get(`/api/rooms/${roomId}/reads`, {
      headers: authHeaders(token),
    });
    const raw = response.data;
    if (raw == null) return {};
    let record: Record<string, unknown>;
    if (Array.isArray(raw)) {
      const out: Record<string, string[]> = {};
      for (const row of raw) {
        if (!row || typeof row !== "object") continue;
        const r = row as Record<string, unknown>;
        const nestedMsg =
          r.message && typeof r.message === "object"
            ? (r.message as Record<string, unknown>)
            : null;
        const mid =
          r.messageId ?? r.message_id ?? r.id ?? nestedMsg?.id ?? nestedMsg?.messageId;
        const readers =
          r.readBy ??
          r.read_by ??
          r.userIds ??
          r.user_ids ??
          r.readers ??
          r.users ??
          r.usernames;
        if (mid == null || !Array.isArray(readers)) continue;
        out[String(mid)] = readers.map((x) => String(x));
      }
      return out;
    }
    if (typeof raw !== "object") return {};
    record = raw as Record<string, unknown>;
    const inner = record.reads ?? record.data ?? record.receipts ?? record.byMessage;
    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
      record = inner as Record<string, unknown>;
    }
    const out: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(record)) {
      if (Array.isArray(v)) out[k] = v.map((x) => String(x));
    }
    return out;
  },

  /**
   * FriendshipController: `GET /api/friendships/incoming`.
   */
  async getIncomingFriendRequests(token: string): Promise<IncomingFriendRequest[]> {
    const response = await backendApi.get("/api/friendships/incoming", {
      headers: authHeaders(token),
    });
    const rows = unwrapList(response.data, ["data", "content", "items", "requests", "friendships"]);
    return rows
      .map((raw) => {
        if (!raw || typeof raw !== "object") return null;
        const v = raw as Record<string, unknown>;
        const idRaw = v.id ?? v.requestId ?? v.friendshipId;
        const requesterIdRaw = v.requesterId ?? v.senderId ?? v.fromUserId ?? v.userId;
        const requesterUsername = firstNonEmptyString(
          v.requesterUsername,
          v.requesterUserName,
          v.requesterName,
          v.requesterDisplayName,
          v.username
        );
        if (idRaw == null || requesterIdRaw == null || !requesterUsername) return null;
        const avatarRaw = firstNonEmptyString(
          v.requesterAvatarUrl,
          v.requester_avatar_url,
          v.avatarUrl,
          v.avatar_url
        );
        const createdAtFriend = firstNonEmptyString(v.createdAt, v.created_at);
        return {
          id: String(idRaw),
          requesterId: String(requesterIdRaw),
          requesterUsername,
          requesterDisplayName:
            firstNonEmptyString(v.requesterDisplayName, v.requester_display_name) ?? null,
          requesterAvatarUrl: avatarRaw ? toAbsoluteBackendUrl(avatarRaw) ?? avatarRaw : null,
          createdAt: createdAtFriend
            ? (normalizeBackendTimestamp(createdAtFriend) ?? createdAtFriend)
            : undefined,
        } as IncomingFriendRequest;
      })
      .filter((x): x is IncomingFriendRequest => x != null);
  },

  /**
   * All peer user ids from `GET /api/friendships` rows that involve the signed-in user
   * (any active row: pending, incoming, or accepted). Use to filter friend-discovery suggestions
   * until `GET /api/users` excludes them server-side.
   */
  async listFriendshipPeerUserIds(token: string): Promise<string[]> {
    const meRaw = viewerUserIdFromToken(token);
    if (!meRaw) return [];
    const me = String(meRaw);
    try {
      const rows = await getFriendshipRowsCached(token);
      const peers = new Set<string>();
      for (const raw of rows) {
        if (!raw || typeof raw !== "object") continue;
        const v = raw as Record<string, unknown>;
        const ids = friendshipRowUserIds(v);
        if (!ids.some((id) => String(id) === me)) continue;
        for (const id of ids) {
          const sid = String(id).trim();
          if (sid && sid !== me) peers.add(sid);
        }
      }
      return Array.from(peers);
    } catch {
      return [];
    }
  },

  /**
   * FriendshipController: `GET /api/friendships` — resolve status for one peer.
   */
  async getFriendshipStatus(token: string, targetUserId: string): Promise<FriendshipSnapshot> {
    const me = viewerUserIdFromToken(token);
    const want = targetUserId.trim();
    try {
      const rows = await getFriendshipRowsCached(token);
      const want = targetUserId.trim();
      const meStr = me?.trim() ?? "";
      const matches = rows.filter((raw) => {
        if (!raw || typeof raw !== "object") return false;
        const v = raw as Record<string, unknown>;
        return friendshipRowUserIds(v).some((id) => String(id) === String(want));
      });
      const match =
        (meStr.length > 0 &&
          matches.find((raw) => {
            const v = raw as Record<string, unknown>;
            return friendshipRowUserIds(v).some((id) => String(id) === meStr);
          })) ??
        matches[0];
      if (match) {
        return parseFriendshipSnapshotForPeer(match, me, want);
      }
    } catch {
      /* fallback below */
    }

    // const tries: Array<() => Promise<{ data: unknown }>> = [
    //   () => backendApi.get(`/api/friendships/with/${uid}`, { headers: authHeaders(token) }),
    //   () => backendApi.get(`/api/friends/status/${uid}`, { headers: authHeaders(token) }),
    //   () =>
    //     backendApi.get(`/api/friends/status`, {
    //       params: { userId: targetUserId },
    //       headers: authHeaders(token),
    //     }),
    //   () => backendApi.get(`/api/users/${uid}/friendship`, { headers: authHeaders(token) }),
    // ];
    // for (const t of tries) {
    //   try {
    //     const r = await t();
    //     const snap = parseFriendshipBody(r.data);
    //     if (snap.status != null) return snap;
    //   } catch {
    //     /* try next */
    //   }
    // }
    return { status: null };
  },

  /**
   * `POST /api/friendships` (FriendshipController).
   * HTTP **409 Conflict** is rethrown so the UI can treat it (e.g. remove from suggestions, reconcile status).
   */
  async sendFriendRequest(token: string, targetUserId: string): Promise<FriendshipSnapshot> {
    clearFriendshipRowsCache(token);
    const headers = authHeaders(token);
    const rid = targetUserId.trim();
    const receiverNum = /^\d+$/.test(rid) ? Number(rid) : null;
    const bodies: Record<string, unknown>[] = [];
    if (receiverNum != null) bodies.push({ receiverId: receiverNum });
    bodies.push({ receiverId: rid });
    const seen = new Set<string>();
    const uniqueBodies = bodies.filter((b) => {
      const key = JSON.stringify(b);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    let lastErr: unknown;
    for (const body of uniqueBodies) {
      try {
        const r = await backendApi.post("/api/friendships", body, { headers });
        return parseFriendshipSnapshotForPeer(r.data, viewerUserIdFromToken(token), rid);
      } catch (e) {
        lastErr = e;
        if (!axios.isAxiosError(e) || e.response == null) {
          continue;
        }
        const st = e.response.status;
        /** Let callers handle 409 (e.g. remove from suggestions, reconcile UI). */
        if (st === 409) {
          throw e;
        }
        if (st === 401 || st === 403) {
          throw e;
        }
        if (st >= 500) {
          throw e;
        }
        /* 400: try next body shape; 404: unlikely for POST same path */
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("Could not send friend request.");
  },

  /**
   * Withdraw outgoing pending request: `DELETE /api/friendships/{id}` (friendship row id).
   * Confirm with your backend if delete uses the same `{id}` as list/incoming rows.
   */
  async cancelFriendRequest(token: string, requestId: string, _targetUserId: string): Promise<void> {
    const ridRaw = requestId.trim();
    if (!ridRaw) {
      throw new Error("Missing friendship id to cancel.");
    }
    const rid = encodeURIComponent(ridRaw);
    await backendApi.delete(`/api/friendships/${rid}`, { headers: authHeaders(token) });
    clearFriendshipRowsCache(token);
  },

  /**
   * FriendshipController: `POST /api/friendships/{id}/accept`.
   */
  async acceptFriendRequest(
    token: string,
    requestId: string,
    _targetUserId?: string
  ): Promise<FriendshipSnapshot> {
    const ridRaw = requestId.trim();
    if (!ridRaw) {
      throw new Error("Missing friendship id to accept.");
    }
    const rid = encodeURIComponent(ridRaw);
    const r = await backendApi.post(`/api/friendships/${rid}/accept`, {}, { headers: authHeaders(token) });
    clearFriendshipRowsCache(token);
    return parseFriendshipBody(r.data);
  },

  /**
   * Reject an incoming request: `DELETE /api/friendships/{id}` (same resource as list/incoming rows).
   * Not listed separately on your controller; adjust if your API uses a dedicated decline route.
   */
  async declineFriendRequest(token: string, requestId: string, _targetUserId?: string): Promise<void> {
    const ridRaw = requestId.trim();
    if (!ridRaw) {
      throw new Error("Missing friendship id to decline.");
    }
    const rid = encodeURIComponent(ridRaw);
    await backendApi.delete(`/api/friendships/${rid}`, { headers: authHeaders(token) });
    clearFriendshipRowsCache(token);
  },

  /** End friendship / remove connection by peer user id (resource shape varies by backend). */
  async removeFriend(token: string, targetUserId: string): Promise<void> {
    const uid = encodeURIComponent(targetUserId.trim());
    await backendApi.delete(`/api/friendships/${uid}`, { headers: authHeaders(token) });
    clearFriendshipRowsCache(token);
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
      if (
        currentUsername &&
        member.username &&
        member.username.trim().toLowerCase() === currentUsername.trim().toLowerCase()
      )
        continue;
      if (!byId.has(member.id)) {
        byId.set(member.id, {
          id: member.id,
          username: member.username,
          online: member.online ?? member.isOnline,
          displayName: null,
          avatarUrl: member.avatarUrl
            ? (toAbsoluteBackendUrl(member.avatarUrl) ?? member.avatarUrl)
            : null,
        });
      }
    }
  }
  return Array.from(byId.values());
};

/**
 * Merge `GET /api/users` with people from chats. Prefer API `avatarUrl` / `displayName`;
 * fill gaps from chat members when the list is partial.
 */
export function mergeUserSummaries(apiUsers: UserSummary[], fromChats: UserSummary[]): UserSummary[] {
  const byId = new Map<string, UserSummary>();
  for (const u of apiUsers) byId.set(u.id, { ...u });
  for (const u of fromChats) {
    const prev = byId.get(u.id);
    if (!prev) {
      byId.set(u.id, { ...u });
      continue;
    }
    const apiAvatar = prev.avatarUrl?.trim();
    const apiDn = prev.displayName?.trim();
    const apiBio = prev.bio?.trim();
    const apiSeen = prev.lastSeenAt?.trim();
    byId.set(u.id, {
      ...prev,
      avatarUrl: apiAvatar ? prev.avatarUrl : u.avatarUrl ?? null,
      displayName: apiDn ? prev.displayName : u.displayName ?? null,
      bio: apiBio ? prev.bio : u.bio ?? null,
      lastSeenAt: apiSeen ? prev.lastSeenAt : u.lastSeenAt ?? null,
      online: prev.online ?? u.online,
    });
  }
  return Array.from(byId.values());
}
