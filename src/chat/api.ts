import axios from "axios";
import { chatDebug, isChatDebug } from "./chatDebug";
import type {
  AuthResult,
  Chat,
  ChatMember,
  ChatMessage,
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

const RESOLVED_BACKEND_ORIGIN = (
  process.env.NEXT_PUBLIC_API_BASE?.trim() ||
  "/backend"
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
/** Public origin for `<audio src>` and `fetch` uploads (same as axios `backendApi` baseURL). */
export const CHAT_BACKEND_ORIGIN = RESOLVED_BACKEND_ORIGIN;
const BACKEND_ORIGIN = CHAT_BACKEND_ORIGIN;
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
  const userObj = v.user && typeof v.user === "object" ? (v.user as Record<string, unknown>) : null;
  const username =
    v.username ??
    v.userName ??
    v.user_name ??
    v.name ??
    v.displayName ??
    v.display_name ??
    (typeof userObj?.username === "string" ? userObj.username : undefined) ??
    (typeof userObj?.name === "string" ? userObj.name : undefined);
  const onlineVal =
    v.online ??
    v.isOnline ??
    v.is_online ??
    v.onlineStatus ??
    v.status ??
    userObj?.online ??
    userObj?.is_online;
  let online: boolean | undefined;
  if (typeof onlineVal === "boolean") online = onlineVal;
  else if (typeof onlineVal === "string") {
    const s = onlineVal.toLowerCase();
    online = s.includes("online") || s === "true";
  }
  const avatarRaw =
    v.avatarUrl ??
    v.avatar_url ??
    v.profileImageUrl ??
    v.profile_image_url ??
    v.imageUrl ??
    v.photoUrl ??
    userObj?.avatarUrl ??
    userObj?.avatar_url ??
    userObj?.profileImageUrl ??
    userObj?.profile_image_url ??
    userObj?.imageUrl ??
    userObj?.photoUrl;
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
      ? lastMessageAtRaw
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
  const reactionList = Array.isArray(v.reactions) ? v.reactions : [];
  const reactionMap: Record<string, number> = {};
  const reactionUsers: Record<string, string[]> = {};
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
    const usersRaw =
      rr.userIds ??
      rr.user_ids ??
      rr.users ??
      rr.reactors ??
      rr.reactedBy ??
      rr.reacted_by;
    if (Array.isArray(usersRaw)) {
      const users = usersRaw
        .map((u) => {
          if (typeof u === "string" || typeof u === "number") return String(u);
          if (!u || typeof u !== "object") return "";
          const vv = u as Record<string, unknown>;
          const id = vv.id ?? vv.userId ?? vv.user_id ?? vv.username ?? vv.userName;
          return id != null ? String(id) : "";
        })
        .filter((v): v is string => v.trim().length > 0);
      if (users.length > 0) reactionUsers[emoji] = Array.from(new Set(users));
    }
  }
  const myReactionRaw = v.myReaction ?? v.my_reaction ?? v.selfReaction;
  const myReaction =
    typeof myReactionRaw === "string" && myReactionRaw.trim().length > 0
      ? myReactionRaw.trim()
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
    (v.replyTo && typeof v.replyTo === "object" ? v.replyTo : undefined);
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
          const pcontent = firstNonEmptyString(p.content, p.message, p.text);
          if (pid == null && !psender && !pcontent) return undefined;
          return {
            id: String(pid ?? crypto.randomUUID()),
            sender: psender ?? undefined,
            content: pcontent ?? undefined,
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
    createdAt: String(v.createdAt ?? v.timestamp ?? new Date().toISOString()),
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
    reactionUsers: Object.keys(reactionUsers).length > 0 ? reactionUsers : undefined,
    myReaction,
  };
};

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
  const createdAt = firstNonEmptyString(v.createdAt, v.created_at, v.timestamp);
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
    reactionCount,
    commentCount,
    myReaction: myReaction ?? undefined,
    comments: comments && comments.length > 0 ? comments : undefined,
  };
};

function mapMyUserProfileFromDto(v: Record<string, unknown>): MyUserProfile {
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
  const themeRaw = String(v.theme ?? v.colorScheme ?? v.appearance ?? "").toLowerCase();
  const theme: "light" | "dark" = themeRaw === "dark" ? "dark" : "light";
  return {
    id: idRaw != null ? String(idRaw) : null,
    username,
    displayName,
    avatarUrl,
    theme,
  };
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
    const themeRaw = String(v.theme ?? v.colorScheme ?? v.appearance ?? "").toLowerCase();
    const theme: "light" | "dark" = themeRaw === "dark" ? "dark" : "light";
    return {
      id: idRaw != null ? String(idRaw) : null,
      username,
      displayName,
      avatarUrl,
      theme,
    };
  },

  async getMyProfile(token: string): Promise<MyUserProfile> {
    const response = await backendApi.get("/api/users/me", {
      headers: authHeaders(token),
    });
    return chatApi.mapMyUserProfileFromDto((response.data ?? {}) as Record<string, unknown>);
  },

  /**
   * Updates the signed-in user via `PUT /api/users/me`.
   * Sends only fields you pass (`displayName`, `avatarUrl`, `theme`). Avoid `username` unless your API allows it.
   */
  async updateMyProfile(
    token: string,
    payload: { displayName?: string; avatarUrl?: string; theme?: "light" | "dark" }
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
    if (Object.keys(body).length === 0) {
      throw new Error("Nothing to update.");
    }
    const response = await backendApi.put("/api/users/me", body, {
      headers: authHeaders(token),
    });
    const d = response.data;
    if (d && typeof d === "object" && Object.keys(d as object).length > 0) {
      return mapMyUserProfileFromDto(d as Record<string, unknown>);
    }
    const again = await backendApi.get("/api/users/me", { headers: authHeaders(token) });
    return mapMyUserProfileFromDto((again.data ?? {}) as Record<string, unknown>);
  },

  /** Upload a profile image via `POST /api/uploads` (same as other media). Returns absolute URL. */
  async uploadProfileImageWithFetch(token: string, file: File): Promise<string> {
    const form = new FormData();
    form.append("file", file, file.name || "profile.jpg");
    const res = await fetch(`${CHAT_BACKEND_ORIGIN}/api/uploads`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    if (!res.ok) {
      throw new Error(`Profile image upload failed (${res.status})`);
    }
    const uploadBody = (await res.json()) as Record<string, unknown>;
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
   * `POST /api/posts/{id}/reactions` — body `{ emoji }`.
   * Response may include `reactionCount`, `myReaction`, or a nested `post`.
   */
  async reactToPost(
    token: string,
    postId: string,
    emoji: string
  ): Promise<{ reactionCount: number; myReaction: string | null }> {
    const response = await backendApi.post(
      `/api/posts/${encodeURIComponent(postId)}/react`,
      { emoji },
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
    return {
      reactionCount,
      myReaction: myReaction || null,
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

  /** ChatRoomController: `GET /api/rooms/{roomId}/history` */
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
    const res = await fetch(`${CHAT_BACKEND_ORIGIN}/api/uploads`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    if (!res.ok) {
      throw new Error(`Voice upload failed (${res.status})`);
    }
    const uploadBody = (await res.json()) as Record<string, unknown>;
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
    { reactions?: Record<string, number>; reactionUsers?: Record<string, string[]>; myReaction?: string | null } | null
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
    const hasMappedReactions =
      !!fromMapped.reactions ||
      !!fromMapped.reactionUsers ||
      typeof fromMapped.myReaction !== "undefined";
    if (hasMappedReactions) {
      return {
        reactions: fromMapped.reactions,
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
    return { reactions, reactionUsers, myReaction };
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
