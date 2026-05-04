import axios, { type AxiosInstance } from "axios";
import { toChat } from "./mappers";
import type { Chat, ChatMember } from "./types";

function parseUsersFromResponseData(raw: unknown): ChatMember[] {
  let list: unknown[] = [];
  if (Array.isArray(raw)) list = raw;
  else if (raw && typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    const candidate = record.users ?? record.members ?? record.data ?? [];
    list = Array.isArray(candidate) ? candidate : [];
  }
  return list
    .map((u: unknown) => {
      const ur = (u ?? {}) as Record<string, unknown>;
      const idRaw = ur.id ?? ur.userId ?? ur.user_id ?? ur.uid;
      const username =
        ur.username ??
        ur.userName ??
        ur.user_name ??
        ur.name ??
        ur.displayName;
      const onlineVal = ur.online ?? ur.isOnline ?? ur.onlineStatus ?? ur.status;
      let online: boolean | undefined;
      if (typeof onlineVal === "boolean") online = onlineVal;
      else if (typeof onlineVal === "string") {
        const s = onlineVal.toLowerCase();
        online = s.includes("online") || s === "true";
      }
      return {
        id: idRaw != null ? String(idRaw) : undefined,
        username: typeof username === "string" ? username : undefined,
        name: typeof username === "string" ? username : undefined,
        online,
        isOnline: typeof onlineVal === "boolean" ? onlineVal : undefined,
        onlineStatus: typeof onlineVal === "string" ? onlineVal : undefined,
        status: typeof onlineVal === "string" ? onlineVal : undefined,
      } satisfies ChatMember;
    })
    .filter((u) => Boolean(u.id && u.username));
}

export function extractKnownUsersFromChats(
  chatList: Chat[],
  currentUsername: string | null
): ChatMember[] {
  const byKey = new Map<string, ChatMember>();
  for (const chat of chatList) {
    for (const m of chat.members ?? []) {
      if (!m.id && !m.username) continue;
      if (currentUsername && m.username === currentUsername) continue;
      const key = m.id ?? `u:${m.username ?? ""}`;
      if (!byKey.has(key)) byKey.set(key, m);
    }
  }
  return Array.from(byKey.values());
}

function extractChatsFromResponseData(raw: unknown): Chat[] {
  let list: unknown[] = [];
  if (Array.isArray(raw)) list = raw;
  else if (raw && typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    const candidate = record.chats ?? record.conversations ?? record.rooms ?? record.data;
    list = Array.isArray(candidate) ? candidate : [];
  }
  return list.map(toChat).filter((c) => c.id.length > 0);
}

export async function loadUsersForPicker(
  api: AxiosInstance,
  accessToken: string,
  chats: Chat[],
  currentSub: string | null
): Promise<{ users: ChatMember[]; error: string }> {
  if (!accessToken) return { users: [], error: "" };

  const configuredPath = process.env.NEXT_PUBLIC_USERS_LIST_PATH?.trim();
  const endpoints = [
    ...(configuredPath ? [configuredPath] : []),
    "/api/chats",
    "/api/rooms",
  ];

  let lastStatus: number | null = null;
  let lastUrl = "";

  for (const endpoint of endpoints) {
    lastUrl = endpoint;
    try {
      const res = await api.get(endpoint, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const parsed =
        endpoint === "/api/chats"
          ? extractKnownUsersFromChats(
              extractChatsFromResponseData(res.data),
              currentSub
            )
          : parseUsersFromResponseData(res.data);
      if (parsed.length > 0) {
        return { users: parsed, error: "" };
      }
    } catch (err) {
      if (axios.isAxiosError(err)) lastStatus = err.response?.status ?? null;
    }
  }

  const fromChats = extractKnownUsersFromChats(chats, currentSub);
  if (fromChats.length > 0) {
    return {
      users: fromChats,
      error:
        lastStatus === 403
          ? `GET ${lastUrl} returned 403 Forbidden. Showing people from your existing chats only.`
          : "Could not load users endpoint response. Showing people from your existing chats only.",
    };
  }

  if (lastStatus === 403) {
    return {
      users: [],
      error: `GET ${lastUrl} returned 403 Forbidden. This account cannot access that endpoint.`,
    };
  }

  return {
    users: [],
    error: lastStatus
      ? `Could not load users (HTTP ${lastStatus}).`
      : "Could not load users list.",
  };
}
