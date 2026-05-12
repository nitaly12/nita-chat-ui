"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { chatApi, readAxiosErrorMessage } from "../../chat/api";
import { avatarTone } from "../../chat/chatPeerProfile";
import type { Chat, FriendshipSnapshot, IncomingFriendRequest, UserSummary } from "../../chat/types";
import { useFriendshipUi } from "../../contexts/FriendshipUiContext";
import FriendButton from "../social/FriendButton";
import { SafeRemoteImage } from "@/components/ui/SafeRemoteImage";

type FriendsMainViewProps = {
  token: string;
  users: UserSummary[];
  chats: Chat[];
  currentUsername: string | null;
  currentUserId: string | null;
};

const relativeTime = (iso?: string): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const day = Math.floor(h / 24);
  return `${day}d ago`;
};

/** Count distinct other users in group chats that include both the viewer and the target (rough mutuals). */
function mutualConnectionsCount(
  targetUserId: string,
  chats: Chat[],
  currentUserId: string | null
): number {
  const me = currentUserId?.trim();
  const target = targetUserId.trim();
  if (!me || !target) return 0;
  const mutual = new Set<string>();
  for (const chat of chats) {
    if (!chat.isGroup) continue;
    const ids = (chat.members ?? [])
      .map((m) => m.id)
      .filter((id): id is string => Boolean(id))
      .map((id) => String(id).trim());
    if (!ids.includes(me) || !ids.includes(target)) continue;
    for (const id of ids) {
      if (id !== me && id !== target) mutual.add(id);
    }
  }
  return mutual.size;
}

export default function FriendsMainView({
  token,
  users,
  chats,
  currentUsername,
  currentUserId,
}: FriendsMainViewProps) {
  const {
    hiddenSuggestionUserIds,
    hideUserFromSuggestions,
    onIncomingFriendResolved,
  } = useFriendshipUi();
  const [incoming, setIncoming] = useState<IncomingFriendRequest[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const onSuggestionSnapshot = useCallback(
    (userId: string, snap: FriendshipSnapshot) => {
      if (snap.status === "ACCEPTED") hideUserFromSuggestions(userId);
    },
    [hideUserFromSuggestions]
  );

  const loadIncoming = useCallback(async () => {
    if (!token.trim()) {
      setIncoming([]);
      return;
    }
    try {
      setErr(null);
      const rows = await chatApi.getIncomingFriendRequests(token);
      setIncoming(rows);
    } catch (e) {
      setErr(readAxiosErrorMessage(e) ?? "Could not load pending requests.");
      setIncoming([]);
    }
  }, [token]);

  useEffect(() => {
    void loadIncoming();
  }, [loadIncoming]);

  const meLower = (currentUsername ?? "").trim().toLowerCase();
  const suggested = users
    .filter((u) => {
      const un = (u.username ?? "").trim().toLowerCase();
      return un && un !== meLower;
    })
    .filter((u) => !hiddenSuggestionUserIds.has(u.id))
    .slice(0, 12);

  const confirm = async (req: IncomingFriendRequest) => {
    setBusyId(req.id);
    setErr(null);
    try {
      await chatApi.acceptFriendRequest(token, req.id, req.requesterId);
      setIncoming((prev) => prev.filter((x) => x.id !== req.id));
      await onIncomingFriendResolved(req.requesterId, true);
    } catch (e) {
      setErr(readAxiosErrorMessage(e) ?? "Could not confirm.");
    } finally {
      setBusyId(null);
    }
  };

  const decline = async (req: IncomingFriendRequest) => {
    setBusyId(req.id);
    setErr(null);
    try {
      await chatApi.declineFriendRequest(token, req.id, req.requesterId);
      setIncoming((prev) => prev.filter((x) => x.id !== req.id));
      await onIncomingFriendResolved(req.requesterId, false);
    } catch (e) {
      setErr(readAxiosErrorMessage(e) ?? "Could not delete request.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[#F9F8F3] dark:bg-slate-950/90">
      <div className="mx-auto max-w-5xl space-y-10 px-4 py-6 pb-12 sm:px-6">
        <section>
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700 dark:text-slate-300">
            Pending requests
          </h2>
          {err ? (
            <p className="mt-2 text-sm text-red-600 dark:text-red-400">{err}</p>
          ) : null}
          {incoming.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">No pending requests.</p>
          ) : (
            <ul className="mt-5 grid list-none grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {incoming.map((req) => {
                const label = req.requesterDisplayName?.trim() || req.requesterUsername;
                const when = relativeTime(req.createdAt);
                const sentLine = when ? `sent ${when}` : "sent recently";
                return (
                  <li
                    key={req.id}
                    className="flex flex-col gap-4 rounded-2xl bg-white p-4 shadow-[0_1px_3px_rgba(15,23,42,0.08)] ring-1 ring-slate-900/[0.04] dark:bg-slate-900 dark:ring-white/10 dark:shadow-none"
                  >
                    <div className="flex items-center gap-3">
                      {req.requesterAvatarUrl ? (
                        <SafeRemoteImage
                          src={req.requesterAvatarUrl}
                          alt=""
                          className="h-12 w-12 shrink-0 rounded-full object-cover ring-1 ring-slate-200/80 dark:ring-slate-600"
                          variant="avatar"
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        <span
                          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-base font-bold text-slate-900 ring-1 ring-slate-200/80 dark:text-slate-900 dark:ring-slate-600 ${avatarTone(label)}`}
                        >
                          {label.slice(0, 1).toUpperCase()}
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-bold text-slate-900 dark:text-slate-100">{label}</p>
                        <p className="mt-0.5 text-xs font-medium text-slate-500 dark:text-slate-400">{sentLine}</p>
                      </div>
                    </div>
                    <div className="flex w-full gap-2">
                      <button
                        type="button"
                        disabled={busyId === req.id}
                        onClick={() => void confirm(req)}
                        className="flex h-8 flex-1 items-center justify-center rounded-lg bg-[#1E7F73] text-sm font-semibold text-white shadow-sm transition hover:bg-[#196a60] disabled:opacity-50"
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        disabled={busyId === req.id}
                        onClick={() => void decline(req)}
                        className="flex h-8 flex-1 items-center justify-center rounded-lg bg-[#E5E7EB] text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-[#d1d5db] disabled:opacity-50 dark:bg-slate-600 dark:text-slate-100 dark:hover:bg-slate-500"
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section>
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700 dark:text-slate-300">
            Suggested connections
          </h2>
          {suggested.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">No suggestions yet.</p>
          ) : (
            <ul className="mt-5 grid list-none grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
              {suggested.map((u) => {
                const label = u.displayName?.trim() || u.username || "User";
                const mutual = mutualConnectionsCount(u.id, chats, currentUserId);
                const mutualLabel =
                  mutual === 0 ? "0 mutuals" : mutual === 1 ? "1 mutual" : `${mutual} mutuals`;
                const href = u.username?.trim()
                  ? `/users/${encodeURIComponent(u.username.trim())}`
                  : null;
                const avatarInner = u.avatarUrl ? (
                  <SafeRemoteImage
                    src={u.avatarUrl}
                    alt=""
                    className="h-full w-full object-cover"
                    variant="avatar"
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <span className="text-lg font-bold text-slate-900 dark:text-slate-900">
                    {label.slice(0, 1).toUpperCase()}
                  </span>
                );
                const avatarShell = (
                  <div
                    className={`flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full ring-1 ring-slate-200/90 dark:ring-slate-600 ${
                      u.avatarUrl ? "bg-slate-100 dark:bg-slate-800" : `dark:text-slate-900 ${avatarTone(label)}`
                    }`}
                  >
                    {avatarInner}
                  </div>
                );
                return (
                  <li
                    key={u.id}
                    className="flex flex-col rounded-2xl bg-white p-4 pt-5 shadow-[0_2px_8px_rgba(15,23,42,0.06)] ring-1 ring-slate-900/[0.05] dark:bg-slate-900 dark:ring-white/10 dark:shadow-none"
                  >
                    <div className="flex flex-1 flex-col items-center text-center">
                      {href ? (
                        <Link href={href} className="flex flex-col items-center transition hover:opacity-90">
                          {avatarShell}
                          <p className="mt-3 line-clamp-2 max-w-full px-1 text-sm font-bold text-slate-900 dark:text-slate-100">
                            {label}
                          </p>
                        </Link>
                      ) : (
                        <div className="flex flex-col items-center">
                          {avatarShell}
                          <p className="mt-3 line-clamp-2 max-w-full px-1 text-sm font-bold text-slate-900 dark:text-slate-100">
                            {label}
                          </p>
                        </div>
                      )}
                      <p className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400">{mutualLabel}</p>
                    </div>
                    <div className="mt-4 w-full shrink-0">
                      <FriendButton
                        token={token}
                        targetUserId={u.id}
                        layout="card"
                        suggestionList
                        onSnapshotChange={onSuggestionSnapshot}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
