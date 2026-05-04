import type { Chat, ChatMember, ChatMessage } from "./types";

export const toChat = (value: unknown): Chat => {
  const record = (value ?? {}) as Record<string, unknown>;
  const membersRaw =
    record.members ??
    record.participants ??
    record.users ??
    record.chatMembers ??
    [];
  const membersArray = Array.isArray(membersRaw) ? membersRaw : [];

  const members: ChatMember[] = membersArray.map((m: unknown) => {
    const mr = (m ?? {}) as Record<string, unknown>;
    const username =
      (mr.username as string | undefined) ??
      (mr.userName as string | undefined) ??
      (mr.user_name as string | undefined) ??
      (mr.name as string | undefined) ??
      (mr.displayName as string | undefined);

    const onlineVal =
      mr.online ??
      mr.isOnline ??
      mr.onlineStatus ??
      mr.status ??
      mr.presence;

    let online: boolean | undefined;
    if (typeof onlineVal === "boolean") online = onlineVal;
    if (typeof onlineVal === "string") {
      const s = onlineVal.toLowerCase();
      online = s.includes("online") || s === "true";
    }

    return {
      id: mr.id != null ? String(mr.id) : undefined,
      username: typeof username === "string" ? username : undefined,
      name: typeof username === "string" ? username : undefined,
      online,
      isOnline: typeof onlineVal === "boolean" ? onlineVal : undefined,
      onlineStatus: typeof onlineVal === "string" ? onlineVal : undefined,
      status: typeof onlineVal === "string" ? onlineVal : undefined,
    };
  });

  const isGroupVal =
    record.isGroup ?? record.is_group ?? record.group ?? record.type === "GROUP";
  const isGroup =
    typeof isGroupVal === "boolean"
      ? isGroupVal
      : typeof isGroupVal === "string"
        ? isGroupVal.toLowerCase() === "true"
        : Boolean(isGroupVal);

  const directNameCandidate =
    record.directName ??
    record.otherUsername ??
    record.otherUserName ??
    record.partnerUsername ??
    record.peerUsername ??
    record.opponentUsername ??
    record.recipientUsername ??
    record.targetUsername ??
    record.privateUsername ??
    record.chatName;

  const directName =
    typeof directNameCandidate === "string" && directNameCandidate.trim().length > 0
      ? directNameCandidate.trim()
      : undefined;

  // Some backends omit `members` for private chats. Synthesize one peer member
  // from common fields so title/user pickers can still work.
  if (!isGroup) {
    const peerIdRaw =
      record.otherUserId ??
      record.other_user_id ??
      record.otherId ??
      record.partnerId ??
      record.partnerUserId ??
      record.peerId ??
      record.opponentId ??
      record.recipientId ??
      record.targetUserId ??
      record.targetUser_id ??
      record.privateUserId;

    const peerId = peerIdRaw != null ? String(peerIdRaw) : undefined;
    const peerNameCandidate =
      directName ??
      (typeof record.groupName === "string" ? record.groupName : undefined) ??
      (typeof record.name === "string" ? record.name : undefined);

    const peerName =
      typeof peerNameCandidate === "string" && peerNameCandidate.trim().length > 0
        ? peerNameCandidate.trim()
        : undefined;

    if (peerId || peerName) {
      const duplicate = members.some(
        (m) => (peerId && m.id === peerId) || (peerName && m.username === peerName)
      );
      if (!duplicate) {
        members.push({ id: peerId, username: peerName, name: peerName });
      }
    }
  }

  return {
    id: String(record.id ?? record.roomId ?? record.chatRoomId ?? ""),
    isGroup,
    groupName: String(
      record.groupName ??
        record.name ??
        record.group_title ??
        record.groupTitle ??
        record.group_name ??
        ""
    ),
    directName,
    members,
  };
};

export const toMessage = (value: unknown): ChatMessage => {
  const record = (value ?? {}) as Record<string, unknown>;
  const createdAtCandidate =
    record.createdAt ??
    record.timestamp ??
    record.time ??
    record.sentAt ??
    record.created_at ??
    record.date;

  const createdAt =
    typeof createdAtCandidate === "string" && createdAtCandidate.length > 0
      ? createdAtCandidate
      : new Date().toISOString();

  return {
    id: String(record.id ?? record.messageId ?? record.msgId ?? crypto.randomUUID()),
    roomId: String(record.roomId ?? record.chatRoomId ?? "general"),
    sender: String(
      record.sender ??
        record.senderName ??
        record.senderUsername ??
        record.sender_username ??
        record.username ??
        record.from ??
        record.user ??
        "Unknown"
    ),
    content: String(
      record.content ??
        record.message ??
        record.text ??
        record.body ??
        record.payload ??
        ""
    ),
    createdAt,
    mine: Boolean(record.mine),
  };
};

export const formatTime = (isoDate: string): string =>
  new Date(isoDate).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export const decodeJwtSub = (token: string): string | null => {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const payload = parts[1];
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    const json = atob(padded);
    const data = JSON.parse(json) as Record<string, unknown>;
    return typeof data.sub === "string" ? data.sub : null;
  } catch {
    return null;
  }
};

export const extractTokenFromLoginResponse = (
  data: unknown,
  headers: Record<string, unknown>
): string => {
  const headerAuthorization =
    typeof headers.authorization === "string"
      ? headers.authorization
      : typeof headers.Authorization === "string"
        ? headers.Authorization
        : "";

  const fromHeader = headerAuthorization.replace(/^Bearer\s+/i, "");

  if (typeof data === "string") return data;

  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    const nested = (record.data ?? record.payload ?? record.result) as
      | Record<string, unknown>
      | undefined;

    const candidate =
      record.accessToken ??
      record.token ??
      record.jwt ??
      record.access_token ??
      record.idToken ??
      nested?.accessToken ??
      nested?.token ??
      nested?.jwt ??
      nested?.access_token ??
      nested?.idToken;

    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate;
    }
  }

  return fromHeader;
};

export const extractMessageList = (data: unknown): unknown[] => {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  const record = data as Record<string, unknown>;

  if (Array.isArray(record.messages)) return record.messages;
  if (Array.isArray(record.content)) return record.content;
  if (Array.isArray(record.data)) return record.data;
  if (Array.isArray(record.result)) return record.result;
  if (Array.isArray(record.payload)) return record.payload;
  return [];
};

export const parseMemberIdsForApi = (ids: string[]): (number | string)[] =>
  ids
    .map((id) => {
      const n = Number(id);
      return Number.isFinite(n) ? n : id;
    })
    .filter((v) => v !== "");

export const parseManualUserIds = (raw: string): string[] =>
  raw
    .split(/[\s,;]+/g)
    .map((s) => s.trim())
    .filter(Boolean);
