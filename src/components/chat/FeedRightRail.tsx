"use client";

import Link from "next/link";
import { useCallback } from "react";
import type { FriendshipSnapshot, UserSummary } from "../../chat/types";
import { useFriendshipUi } from "../../contexts/FriendshipUiContext";
import FriendButton from "../social/FriendButton";

const TRENDING = ["#CodingChallenges", "#PhnomPenhDevs", "#CodingPost"] as const;

type FeedRightRailProps = {
  token: string;
  users: UserSummary[];
  currentUsername: string | null;
};

export default function FeedRightRail({ token, users, currentUsername }: FeedRightRailProps) {
  const { hiddenSuggestionUserIds, hideUserFromSuggestions } = useFriendshipUi();

  const onSuggestionSnapshot = useCallback(
    (userId: string, snap: FriendshipSnapshot) => {
      if (snap.status === "ACCEPTED") hideUserFromSuggestions(userId);
    },
    [hideUserFromSuggestions]
  );

  const suggested = users
    .filter((u) => {
      const un = (u.username ?? "").trim().toLowerCase();
      const me = (currentUsername ?? "").trim().toLowerCase();
      return un && un !== me;
    })
    .filter((u) => !hiddenSuggestionUserIds.has(u.id))
    .slice(0, 6);

  return (
    <aside className="hidden h-full min-h-0 w-[280px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-[#e5e8e0] bg-[#fcfbf7] p-4 dark:border-slate-700 dark:bg-slate-900/90 lg:flex xl:w-[300px]">
      <div className="rounded-2xl border border-[#e0e6df] bg-white p-4 shadow-sm dark:border-slate-600 dark:bg-slate-800/90">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Trending topics
        </h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {TRENDING.map((tag) => (
            <span
              key={tag}
              className="inline-flex rounded-full border border-blue-200/80 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-200"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-[#e0e6df] bg-white p-4 shadow-sm dark:border-slate-600 dark:bg-slate-800/90">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Suggested connections
        </h2>
        <ul className="mt-3 space-y-3">
          {suggested.length === 0 ? (
            <li className="text-sm text-slate-500 dark:text-slate-400">No suggestions yet.</li>
          ) : (
            suggested.map((u, i) => {
              const label = u.displayName?.trim() || u.username || "User";
              const mutual = (i % 4) + 2;
              const href = u.username?.trim()
                ? `/users/${encodeURIComponent(u.username.trim())}`
                : null;
              const inner = (
                <>
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-slate-100 text-sm font-semibold text-slate-700 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200">
                    {label.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{label}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{mutual} mutuals</p>
                  </div>
                </>
              );
              return (
                <li key={u.id}>
                  <div className="flex items-center gap-2 rounded-xl py-1">
                    {href ? (
                      <Link
                        href={href}
                        className="flex min-w-0 flex-1 items-center gap-3 transition hover:bg-slate-50 dark:hover:bg-slate-700/50"
                      >
                        {inner}
                      </Link>
                    ) : (
                      <div className="flex min-w-0 flex-1 items-center gap-3">{inner}</div>
                    )}
                    <FriendButton
                      token={token}
                      targetUserId={u.id}
                      compact
                      suggestionList
                      className="shrink-0"
                      onSnapshotChange={onSuggestionSnapshot}
                    />
                  </div>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </aside>
  );
}
