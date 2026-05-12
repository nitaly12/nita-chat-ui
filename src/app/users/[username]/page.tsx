"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { chatApi, parseJwtIdentity, readAxiosErrorMessage } from "@/chat/api";
import { avatarTone, toAbsoluteAvatarUrl } from "@/chat/chatPeerProfile";
import CommentSection from "@/components/profile/CommentSection";
import FriendButton from "@/components/social/FriendButton";
import type { Chat, MyUserProfile, PostComment, UserPost, UserSummary } from "@/chat/types";

/** Distinct other users in group chats that include both the viewer and the target (same heuristic as Friends). */
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

function formatPostDate(iso?: string): string {
  if (!iso?.trim()) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export default function UserPublicProfilePage() {
  const params = useParams();
  const raw = params?.username;
  const username =
    typeof raw === "string"
      ? decodeURIComponent(raw)
      : Array.isArray(raw)
        ? decodeURIComponent(raw[0] ?? "")
        : "";

  const [accessToken, setAccessToken] = useState("");
  const [user, setUser] = useState<UserSummary | null>(null);
  const [viewer, setViewer] = useState<MyUserProfile | null>(null);
  const [posts, setPosts] = useState<UserPost[]>([]);
  const [chats, setChats] = useState<Chat[]>([]);
  const [commentsByPostId, setCommentsByPostId] = useState<Record<string, PostComment[]>>({});
  const [commentLoadErrorByPostId, setCommentLoadErrorByPostId] = useState<Record<string, string>>(
    {}
  );
  const [error, setError] = useState("");
  const [postsError, setPostsError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setAccessToken(typeof window !== "undefined" ? window.localStorage.getItem("accessToken") ?? "" : "");
  }, []);

  useEffect(() => {
    if (!accessToken.trim()) return;
    void chatApi
      .getMyProfile(accessToken)
      .then(setViewer)
      .catch(() => setViewer(null));
  }, [accessToken]);

  useEffect(() => {
    if (!username.trim()) {
      setLoading(false);
      setError("Missing username.");
      return;
    }
    if (!accessToken.trim()) {
      setLoading(false);
      setError("Sign in from the home page to view profiles.");
      return;
    }
    const token = accessToken;
    let cancelled = false;
    void (async () => {
      setPosts([]);
      setPostsError("");
      try {
        let u: UserSummary | null = await chatApi.getUserProfileByUsername(token, username);
        if (!u && /^\d+$/.test(username.trim())) {
          u = await chatApi.getUserById(token, username.trim());
        }
        if (!u) {
          const list = await chatApi.getUsersList(token);
          if (cancelled) return;
          const ju = (s: string) => s.trim().toLowerCase();
          const want = ju(username);
          u =
            list.find((x) => ju(x.username) === want) ||
            list.find((x) => x.displayName && ju(x.displayName) === want) ||
            null;
        }
        if (cancelled) return;
        setUser(u);
        if (!u) {
          setError("User not found.");
          return;
        }
        setError("");
        try {
          const p = await chatApi.getPostsByUserId(token, u.id);
          if (!cancelled) setPosts(p);
        } catch (pe) {
          if (!cancelled) {
            setPostsError(readAxiosErrorMessage(pe) ?? "Could not load posts.");
          }
        }
      } catch (e) {
        if (!cancelled) setError(readAxiosErrorMessage(e) ?? "Could not load profile.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [username, accessToken]);

  const { viewerUserId, viewerUsername } = useMemo(() => {
    const jwt = parseJwtIdentity(accessToken);
    return {
      viewerUserId: viewer?.id?.trim() || jwt.userId?.trim() || null,
      viewerUsername: viewer?.username?.trim() || jwt.username?.trim() || null,
    };
  }, [viewer?.id, viewer?.username, accessToken]);

  const isSelf = Boolean(viewerUserId && user?.id && user.id === viewerUserId);

  useEffect(() => {
    if (!accessToken.trim() || !user?.id || isSelf) {
      setChats([]);
      return;
    }
    let cancelled = false;
    void chatApi
      .getChats(accessToken)
      .then((list) => {
        if (!cancelled) setChats(list);
      })
      .catch(() => {
        if (!cancelled) setChats([]);
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, user?.id, isSelf]);

  const postsIdsKey = useMemo(() => posts.map((p) => p.id).join("|"), [posts]);

  useEffect(() => {
    if (!accessToken.trim() || posts.length === 0) return;
    const token = accessToken;
    let cancelled = false;
    void (async () => {
      const next: Record<string, PostComment[]> = {};
      const nextErr: Record<string, string> = {};
      await Promise.all(
        posts.map(async (post) => {
          let list = post.comments ?? [];
          if (list.length === 0) {
            try {
              list = await chatApi.getPostComments(token, post.id);
            } catch {
              list = [];
              nextErr[post.id] = "Could not load comments.";
            }
          }
          next[post.id] = list;
        })
      );
      if (!cancelled) {
        setCommentsByPostId((prev) => {
          const merged = { ...prev };
          for (const id of Object.keys(next)) {
            merged[id] = next[id] ?? [];
          }
          return merged;
        });
        setCommentLoadErrorByPostId((prev) => ({ ...prev, ...nextErr }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accessToken, postsIdsKey]);

  const loadCommentsForPost = async (postId: string): Promise<void> => {
    if (!accessToken.trim()) return;
    try {
      const list = await chatApi.getPostComments(accessToken, postId);
      setCommentsByPostId((prev) => ({ ...prev, [postId]: list }));
      setCommentLoadErrorByPostId((prev) => {
        const next = { ...prev };
        delete next[postId];
        return next;
      });
    } catch (e) {
      setCommentLoadErrorByPostId((prev) => ({
        ...prev,
        [postId]: readAxiosErrorMessage(e) ?? "Could not load comments.",
      }));
    }
  };

  const label = user?.displayName?.trim() || user?.username || username;
  const initials = label.slice(0, 1).toUpperCase();
  const avatarUrl =
    user?.avatarUrl?.trim() != null && user.avatarUrl.trim().length > 0
      ? toAbsoluteAvatarUrl(user.avatarUrl)
      : undefined;

  const viewerDisplayName =
    viewer?.displayName?.trim() || viewer?.username?.trim() || "You";
  const viewerAvatarUrl = viewer?.avatarUrl ?? null;

  const mutualCount = user && viewerUserId ? mutualConnectionsCount(user.id, chats, viewerUserId) : 0;
  const mutualFriendsLabel = isSelf
    ? "—"
    : mutualCount === 1
      ? "1 mutual friend"
      : `${mutualCount} mutual friends`;

  const lastSeenLabel = user?.lastSeenAt?.trim()
    ? Number.isNaN(new Date(user.lastSeenAt).getTime())
      ? user.lastSeenAt.trim()
      : new Date(user.lastSeenAt).toLocaleString()
    : "—";

  const cardBorder = "color-mix(in_srgb, var(--text-main) 12%, transparent)";
  const cardBg = "var(--bg-main)";

  return (
    <div
      className="min-h-screen"
      style={{
        backgroundColor: "var(--bg-main)",
        color: "var(--text-main)",
      }}
    >
      <div className="mx-auto max-w-5xl px-4 py-6 pb-12 sm:px-6 lg:px-8">
        <Link
          href="/"
          aria-label="Back to home"
          className="mb-5 inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
        >
          <svg
            className="h-5 w-5 shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
          <span>Back</span>
        </Link>

        {loading ? (
          <p className="text-sm opacity-70">Loading profile…</p>
        ) : error && !user ? (
          <div
            className="rounded-2xl border px-4 py-3 text-sm"
            style={{
              borderColor: "color-mix(in_srgb, var(--text-main) 18%, transparent)",
              backgroundColor: "color-mix(in_srgb, var(--text-main) 6%, transparent)",
            }}
          >
            {error}
          </div>
        ) : user ? (
          <>
            {/* Profile header card */}
            <div
              className="overflow-hidden rounded-2xl border shadow-sm ring-1 ring-black/[0.03] dark:ring-white/[0.06]"
              style={{ borderColor: cardBorder, backgroundColor: cardBg }}
            >
              <div className="relative h-40 w-full overflow-hidden md:h-48" aria-hidden>
                <svg
                  className="absolute inset-0 h-full w-full"
                  preserveAspectRatio="xMidYMid slice"
                  viewBox="0 0 900 220"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <defs>
                    <linearGradient id="profileCoverGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#bfe8df" />
                      <stop offset="45%" stopColor="#d4ead8" />
                      <stop offset="100%" stopColor="#c5dff0" />
                    </linearGradient>
                  </defs>
                  <rect width="900" height="220" fill="url(#profileCoverGrad)" />
                  <ellipse cx="140" cy="200" rx="260" ry="100" fill="#6fa89a" opacity="0.22" />
                  <ellipse cx="720" cy="40" rx="280" ry="140" fill="#5a8ab8" opacity="0.18" />
                  <ellipse cx="480" cy="120" rx="200" ry="80" fill="#8bc4a8" opacity="0.15" />
                </svg>
              </div>

              <div className="relative px-5 pb-6 pt-0 md:px-8">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                  <div className="flex min-w-0 flex-1 flex-col gap-4 sm:flex-row sm:items-start sm:gap-5">
                    <div
                      className={`relative z-10 -mt-14 flex h-28 w-28 shrink-0 items-center justify-center overflow-hidden rounded-full border-[5px] text-3xl font-bold shadow-md sm:h-32 sm:w-32 ${
                        avatarUrl ? "" : `text-slate-900 dark:text-slate-900 ${avatarTone(label)}`
                      }`}
                      style={{
                        borderColor: cardBg,
                        backgroundColor: avatarUrl
                          ? "color-mix(in_srgb, var(--text-main) 8%, transparent)"
                          : undefined,
                      }}
                    >
                      {avatarUrl ? (
                        <img
                          src={avatarUrl}
                          alt=""
                          className="h-full w-full object-cover"
                          loading="eager"
                          decoding="async"
                        />
                      ) : (
                        initials
                      )}
                    </div>

                    <div className="min-w-0 flex-1 sm:pt-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50 md:text-3xl">
                          {label}
                        </h1>
                        <span
                          className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold text-slate-900 ring-1 ring-slate-200/80 dark:text-slate-900 dark:ring-slate-600 ${avatarTone(label)}`}
                          title="Profile"
                          aria-hidden
                        >
                          {initials}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                        @{user.username}
                        {typeof user.online === "boolean" ? (
                          <>
                            {" "}
                            <span className="text-slate-300 dark:text-slate-600" aria-hidden>
                              •
                            </span>{" "}
                            <span className={user.online ? "text-emerald-600 dark:text-emerald-400" : ""}>
                              {user.online ? "Online" : "Offline"}
                            </span>
                          </>
                        ) : null}
                      </p>
                      {user.bio?.trim() ? (
                        <p className="mt-2 max-w-xl text-sm font-medium leading-relaxed text-slate-800 dark:text-slate-200">
                          {user.bio.trim()}
                        </p>
                      ) : (
                        <p className="mt-2 text-sm text-slate-500 dark:text-slate-500">No bio yet.</p>
                      )}
                    </div>
                  </div>

                  {!isSelf && accessToken.trim() ? (
                    <div className="flex shrink-0 flex-wrap items-center gap-2 lg:justify-end sm:pt-2">
                      <Link
                        href="/"
                        title="Open Messages to chat"
                        className="inline-flex items-center gap-2 rounded-xl bg-[#1E7F73] px-3 py-1 text-sm font-semibold text-white shadow-sm transition hover:bg-[#196a60]"
                      >
                        <span aria-hidden className="text-base">
                          💬
                        </span>
                        Message
                      </Link>
                      <FriendButton token={accessToken} targetUserId={user.id} compact />
                      <details className="relative">
                        <summary className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-xl border border-slate-200 bg-[#E5E7EB] text-slate-600 shadow-sm transition hover:bg-[#d1d5db] dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600 [&::-webkit-details-marker]:hidden">
                          <span className="sr-only">More options</span>
                          <span aria-hidden className="px-0.5 text-xl font-bold leading-none tracking-tighter">
                            ···
                          </span>
                        </summary>
                        <div
                          className="absolute right-0 z-20 mt-1 min-w-[10rem] rounded-xl border py-2 text-sm shadow-lg dark:border-slate-600 dark:bg-slate-800"
                          style={{ borderColor: cardBorder, backgroundColor: cardBg }}
                        >
                          <p className="px-3 text-xs text-slate-500 dark:text-slate-400">
                            More options coming soon.
                          </p>
                        </div>
                      </details>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            {/* About + Posts */}
            <div className="mt-6 grid gap-6 lg:grid-cols-3">
              <aside
                className="rounded-2xl border p-5 shadow-sm ring-1 ring-black/[0.03] dark:ring-white/[0.06] lg:col-span-1"
                style={{ borderColor: cardBorder, backgroundColor: cardBg }}
              >
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">About</h2>
                <dl className="mt-4 space-y-4 text-sm">
                  <div>
                    <dt className="font-bold text-slate-900 dark:text-slate-100">Bio</dt>
                    <dd className="mt-1 font-normal leading-relaxed text-slate-600 dark:text-slate-300">
                      {user.bio?.trim() || "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-bold text-slate-900 dark:text-slate-100">Mutual friends</dt>
                    <dd className="mt-1 text-slate-600 dark:text-slate-300">{mutualFriendsLabel}</dd>
                  </div>
                  <div>
                    <dt className="font-bold text-slate-900 dark:text-slate-100">Last seen</dt>
                    <dd className="mt-1 text-slate-600 dark:text-slate-300">{lastSeenLabel}</dd>
                  </div>
                  <div>
                    <dt className="font-bold text-slate-900 dark:text-slate-100">Location</dt>
                    <dd className="mt-1 text-slate-600 dark:text-slate-300">Not set</dd>
                  </div>
                </dl>
              </aside>

              <section
                className="rounded-2xl border p-5 shadow-sm ring-1 ring-black/[0.03] dark:ring-white/[0.06] lg:col-span-2"
                style={{ borderColor: cardBorder, backgroundColor: cardBg }}
              >
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Posts</h2>
                {postsError ? (
                  <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">{postsError}</p>
                ) : posts.length === 0 ? (
                  <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">No posts yet.</p>
                ) : (
                  <ul className="mt-5 space-y-5">
                    {posts.map((post) => {
                      const commentTotal =
                        typeof post.commentCount === "number"
                          ? post.commentCount
                          : (commentsByPostId[post.id] ?? []).length;
                      const likeTotal = typeof post.reactionCount === "number" ? post.reactionCount : 0;
                      const ts = formatPostDate(post.createdAt);
                      return (
                        <li
                          key={post.id}
                          className="overflow-hidden rounded-2xl border p-4 shadow-sm ring-1 ring-black/[0.03] dark:ring-white/[0.06]"
                          style={{ borderColor: cardBorder, backgroundColor: cardBg }}
                        >
                          <div className="flex items-center gap-3">
                            <div
                              className={`flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full text-sm font-bold text-slate-900 ${
                                avatarUrl ? "bg-slate-100 dark:bg-slate-800" : avatarTone(label)
                              }`}
                            >
                              {avatarUrl ? (
                                <img
                                  src={avatarUrl}
                                  alt=""
                                  className="h-full w-full object-cover"
                                  loading="lazy"
                                  decoding="async"
                                />
                              ) : (
                                initials
                              )}
                            </div>
                            <p className="truncate text-sm font-bold text-slate-900 dark:text-slate-100">
                              {label}
                            </p>
                          </div>

                          {post.title ? (
                            <p className="mt-3 font-semibold text-slate-900 dark:text-slate-100">{post.title}</p>
                          ) : null}
                          {post.content.trim() ? (
                            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                              {post.content}
                            </p>
                          ) : null}
                          {post.mediaUrl ? (
                            <img
                              src={post.mediaUrl}
                              alt=""
                              className="mt-3 w-full rounded-xl object-cover max-h-80"
                              loading="lazy"
                              decoding="async"
                            />
                          ) : null}

                          <div className="mt-4 flex flex-col gap-3 border-t border-slate-100 pt-3 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400 sm:flex-row sm:items-center sm:justify-between">
                            <span className="shrink-0">
                              Post timestamp: {ts || "—"}
                            </span>
                            <span className="text-right">
                              {commentTotal} Comment{commentTotal === 1 ? "" : "s"} · {likeTotal}{" "}
                              Like{likeTotal === 1 ? "" : "s"}
                            </span>
                          </div>

                          <div className="mt-4">
                            {typeof post.commentCount === "number" &&
                            post.commentCount > 0 &&
                            (commentsByPostId[post.id] ?? []).length === 0 ? (
                              <div className="mb-3 flex items-center justify-between gap-3">
                                <p className="text-sm opacity-75">
                                  {post.commentCount} comment{post.commentCount === 1 ? "" : "s"}
                                </p>
                                <button
                                  type="button"
                                  className="rounded-lg border px-3 py-1.5 text-sm font-semibold hover:bg-[color-mix(in_srgb,var(--text-main)_6%,transparent)]"
                                  style={{
                                    borderColor:
                                      "color-mix(in_srgb, var(--text-main) 14%, transparent)",
                                  }}
                                  onClick={() => void loadCommentsForPost(post.id)}
                                >
                                  View comments
                                </button>
                              </div>
                            ) : null}
                            {commentLoadErrorByPostId[post.id] ? (
                              <p className="mb-3 text-sm text-amber-700 dark:text-amber-300">
                                {commentLoadErrorByPostId[post.id]}
                              </p>
                            ) : null}
                            <CommentSection
                              postId={post.id}
                              token={accessToken}
                              currentUserId={viewerUserId}
                              currentUsername={viewerUsername}
                              comments={commentsByPostId[post.id] ?? []}
                              onCommentsChange={(next) => {
                                setCommentsByPostId((prev) => ({
                                  ...prev,
                                  [post.id]: next,
                                }));
                              }}
                              currentUserDisplayName={viewerDisplayName}
                              currentUserAvatarUrl={viewerAvatarUrl}
                            />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
