import { getImageUrl } from "@/utils/getImageUrl";
import type { Chat, UserSummary } from "./types";

function norm(s: string | undefined | null): string {
  return (s ?? "").trim().toLowerCase();
}

export type PeerHint = { id?: string; username?: string };

/** Private-chat peer: prefer a real member row, else room `directName` / `groupName` (many APIs omit `members`). */
export function directPeerRef(chat: Chat, currentUsername: string | null): PeerHint | undefined {
  if (chat.isGroup) return undefined;
  const me = norm(currentUsername);
  const members = chat.members ?? [];
  const other = members.find((m) => {
    const un = m.username?.trim();
    if (!un) return false;
    if (me && norm(un) === me) return false;
    return true;
  });
  if (other?.username?.trim()) return { id: other.id, username: other.username.trim() };

  const fromDirect = chat.directName?.trim();
  if (fromDirect && (!me || norm(fromDirect) !== me)) return { username: fromDirect };

  const fromGroup = chat.groupName?.trim();
  if (fromGroup && (!me || norm(fromGroup) !== me)) return { username: fromGroup };

  return undefined;
}

export function pickUserSummary(users: UserSummary[], peer: PeerHint | undefined): UserSummary | undefined {
  if (!peer) return undefined;
  const pun = norm(peer.username);
  return users.find((u) => {
    if (peer.id != null && peer.id !== "" && u.id === peer.id) return true;
    if (pun && norm(u.username) === pun) return true;
    if (pun && norm(u.displayName) === pun) return true;
    return false;
  });
}

export function resolveChatName(chat: Chat, currentUsername: string | null, users: UserSummary[]): string {
  if (chat.isGroup) return chat.groupName || "Group";
  const peer = directPeerRef(chat, currentUsername);
  const fromList = pickUserSummary(users, peer);
  const display = fromList?.displayName?.trim();
  return (
    display ||
    peer?.username ||
    chat.directName?.trim() ||
    chat.groupName?.trim() ||
    `Chat #${chat.id}`
  );
}

export function avatarTone(seed: string): string {
  const tones = [
    "bg-pink-200",
    "bg-amber-200",
    "bg-cyan-200",
    "bg-violet-200",
    "bg-emerald-200",
  ];
  const n = seed.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  return tones[n % tones.length];
}

export function toAbsoluteAvatarUrl(raw: string): string {
  return getImageUrl(raw) ?? "";
}

/** Room image for groups; for DMs: member DTO then `GET /api/users` row. */
export function resolveChatAvatarUrl(
  chat: Chat,
  currentUsername: string | null,
  users: UserSummary[]
): string | undefined {
  if (chat.avatarUrl?.trim()) return toAbsoluteAvatarUrl(chat.avatarUrl);
  if (chat.isGroup) return undefined;
  const peer = directPeerRef(chat, currentUsername);
  const me = norm(currentUsername);
  const other = (chat.members ?? []).find((m) => {
    const un = m.username?.trim();
    if (!un) return false;
    if (me && norm(un) === me) return false;
    return true;
  });
  if (other?.avatarUrl?.trim()) return toAbsoluteAvatarUrl(other.avatarUrl);
  const fromList = pickUserSummary(users, peer)?.avatarUrl;
  if (fromList?.trim()) return toAbsoluteAvatarUrl(fromList);
  return undefined;
}

export function resolveOtherOnline(chat: Chat, currentUsername: string | null, users: UserSummary[]): boolean {
  if (chat.isGroup) return false;
  const peer = directPeerRef(chat, currentUsername);
  const me = norm(currentUsername);
  const other = (chat.members ?? []).find((m) => {
    const un = m.username?.trim();
    if (!un) return false;
    if (me && norm(un) === me) return false;
    return true;
  });
  if (other && (other.online !== undefined || other.isOnline !== undefined)) {
    return Boolean(other.online ?? other.isOnline);
  }
  return Boolean(pickUserSummary(users, peer)?.online);
}
