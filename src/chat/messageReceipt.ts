import type { ChatMessage } from "./types";

export function isMessageFromCurrentUser(
  msg: ChatMessage,
  currentUserId: string | null,
  currentUsername: string | null
): boolean {
  if (currentUserId && msg.senderId != null && String(msg.senderId) === String(currentUserId)) return true;
  if (currentUsername && msg.sender && msg.sender === currentUsername) return true;
  return Boolean(msg.mine);
}

function isMeToken(
  raw: string,
  currentUserId: string | null,
  currentUsername: string | null
): boolean {
  const t = String(raw).trim();
  if (!t) return false;
  if (currentUserId != null && String(currentUserId) === t) return true;
  if (
    currentUsername != null &&
    currentUsername.trim().toLowerCase() === t.toLowerCase()
  )
    return true;
  return false;
}

function parseReaders(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (entry && typeof entry === "object") {
        const o = entry as Record<string, unknown>;
        const u = o.userId ?? o.id ?? o.username ?? o.userName ?? o.name;
        return u != null ? String(u) : "";
      }
      return "";
    })
    .filter(Boolean);
}

/** Merge `GET /api/rooms/{roomId}/reads` into history so receipts can show. */
export function mergeRoomReadsIntoMessages(
  messages: ChatMessage[],
  reads: Record<string, string[]>,
  currentUserId: string | null,
  currentUsername: string | null
): ChatMessage[] {
  if (!reads || Object.keys(reads).length === 0) return messages;
  return messages.map((m) => {
    if (!isMessageFromCurrentUser(m, currentUserId, currentUsername)) return m;
    const readers = reads[String(m.id)];
    if (!readers?.length) return m;
    const readBySomeoneElse = readers.some((r) => !isMeToken(String(r), currentUserId, currentUsername));
    if (!readBySomeoneElse) return m;
    return {
      ...m,
      seen: true,
      readBy: readers,
      seenBy: readers,
    };
  });
}

/**
 * Apply a Socket.IO `messages-seen` payload into the message list.
 * Supports: `messageIds` + `userId`, nested `messages: [{ id, seenBy }]`, `lastReadMessageId` + `userId`, or `all: true`.
 */
export function applyMessagesSeenEvent(
  messages: ChatMessage[],
  activeRoomId: string,
  payload: unknown,
  currentUserId: string | null,
  currentUsername: string | null
): ChatMessage[] {
  const p = (payload ?? {}) as Record<string, unknown>;
  const conv = String(p.conversationId ?? p.roomId ?? p.chatId ?? "").trim();
  if (conv && conv !== activeRoomId) return messages;

  const readerSingle =
    p.userId != null
      ? String(p.userId)
      : p.readerId != null
        ? String(p.readerId)
        : undefined;

  const seenAt =
    typeof p.seenAt === "string" && p.seenAt.length > 0
      ? p.seenAt
      : typeof p.timestamp === "string" && p.timestamp.length > 0
        ? p.timestamp
        : undefined;

  const extraFromPayload = parseReaders(p.seenBy ?? p.readBy);

  const messageIds = new Set<string>();
  if (Array.isArray(p.messageIds)) {
    for (const id of p.messageIds) messageIds.add(String(id));
  }

  const nested = Array.isArray(p.messages) ? p.messages : null;
  const patchById = new Map<string, string[]>();
  if (nested) {
    for (const item of nested) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const mid = o.id ?? o.messageId;
      if (mid == null) continue;
      const id = String(mid);
      const rs = parseReaders(o.seenBy ?? o.readBy);
      if (rs.length) patchById.set(id, rs);
      messageIds.add(id);
    }
  }

  const lastReadId =
    p.lastReadMessageId != null
      ? String(p.lastReadMessageId)
      : p.lastReadId != null
        ? String(p.lastReadId)
        : undefined;

  let indexCutoff = -1;
  if (lastReadId && messageIds.size === 0 && !nested?.length) {
    indexCutoff = messages.findIndex((m) => String(m.id) === lastReadId);
  }

  const markAllMine = p.all === true || p.everything === true;

  return messages.map((m, idx) => {
    if (String(m.roomId) !== String(activeRoomId)) return m;
    if (!isMessageFromCurrentUser(m, currentUserId, currentUsername)) return m;

    let shouldUpdate = false;
    if (patchById.has(String(m.id))) shouldUpdate = true;
    else if (messageIds.size > 0 && messageIds.has(String(m.id))) shouldUpdate = true;
    else if (indexCutoff >= 0 && idx <= indexCutoff) shouldUpdate = true;
    else if (markAllMine) shouldUpdate = true;

    if (!shouldUpdate) return m;

    const merged = new Set<string>(
      [...(m.seenBy ?? []), ...(m.readBy ?? [])].map(String)
    );
    if (readerSingle) merged.add(readerSingle);
    for (const r of extraFromPayload) merged.add(r);
    const patch = patchById.get(String(m.id));
    if (patch) for (const r of patch) merged.add(r);

    const mergedArr = [...merged];
    const readBySomeoneElse = mergedArr.some(
      (r) => !isMeToken(r, currentUserId, currentUsername)
    );

    return {
      ...m,
      seenBy: mergedArr.length > 0 ? mergedArr : m.seenBy,
      readBy: mergedArr.length > 0 ? mergedArr : m.readBy,
      readAt: seenAt ?? m.readAt,
      seen: readBySomeoneElse,
    };
  });
}
