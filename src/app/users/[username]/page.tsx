"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { chatApi, parseJwtIdentity, readAxiosErrorMessage } from "@/chat/api";
import { avatarTone, toAbsoluteAvatarUrl } from "@/chat/chatPeerProfile";
import CommentSection from "@/components/profile/CommentSection";
import type { MyUserProfile, PostComment, UserPost, UserSummary } from "@/chat/types";

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
  const { viewerUserId, viewerUsername } = useMemo(() => {
    const jwt = parseJwtIdentity(accessToken);
    return {
      viewerUserId: viewer?.id?.trim() || jwt.userId?.trim() || null,
      viewerUsername: viewer?.username?.trim() || jwt.username?.trim() || null,
    };
  }, [viewer?.id, viewer?.username, accessToken]);

  return (
    <div
      className="min-h-screen"
      style={{
        backgroundColor: "var(--bg-main)",
        color: "var(--text-main)",
      }}
    >
      <div className="mx-auto max-w-lg px-4 py-8">
        <Link
          href="/"
          aria-label="Back to messages"
          className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
        >
          <svg
            className="h-6 w-6 shrink-0"
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
            <div
              className="overflow-hidden rounded-2xl border shadow-sm"
              style={{
                borderColor: "color-mix(in_srgb, var(--text-main) 14%, transparent)",
                backgroundColor: "var(--bg-main)",
              }}
            >
              <div
                className="h-24"
                style={{
                  background:
                    "linear-gradient(90deg, color-mix(in_srgb, var(--text-main) 12%, transparent), color-mix(in_srgb, var(--text-main) 6%, transparent))",
                }}
              />
              <div className="-mt-10 flex flex-col items-center px-6 pb-6 pt-0">
                <div
                  className={`flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border-4 text-2xl font-semibold shadow-md ${
                    avatarUrl
                      ? ""
                      : `text-slate-800 dark:text-slate-900 ${avatarTone(label)}`
                  }`}
                  style={{
                    borderColor: "var(--bg-main)",
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
                <h1 className="mt-4 text-center text-2xl font-bold">{label}</h1>
                <p className="text-center text-sm opacity-70">@{user.username}</p>
                {typeof user.online === "boolean" ? (
                  <p className="mt-1 text-center text-xs opacity-70">
                    <span
                      className={`mr-1 inline-block h-2 w-2 rounded-full ${
                        user.online ? "bg-green-500" : "bg-slate-400"
                      }`}
                    />
                    {user.online ? "Online" : "Offline"}
                  </p>
                ) : null}
                {user.bio?.trim() ? (
                  <p className="mt-4 max-w-md text-center text-sm leading-relaxed opacity-85">
                    {user.bio.trim()}
                  </p>
                ) : (
                  <p className="mt-4 text-center text-sm opacity-55">No bio yet.</p>
                )}
                {user.lastSeenAt?.trim() ? (
                  <p className="mt-2 text-center text-xs opacity-55">
                    Last seen{" "}
                    {Number.isNaN(new Date(user.lastSeenAt).getTime())
                      ? user.lastSeenAt
                      : new Date(user.lastSeenAt).toLocaleString()}
                  </p>
                ) : null}
              </div>
            </div>

            <section
              className="mt-8 rounded-2xl border p-5 shadow-sm"
              style={{
                borderColor: "color-mix(in_srgb, var(--text-main) 14%, transparent)",
                backgroundColor: "var(--bg-main)",
              }}
            >
              <h2 className="text-lg font-semibold">Posts</h2>
              {postsError ? (
                <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">{postsError}</p>
              ) : posts.length === 0 ? (
                <p className="mt-2 text-sm opacity-70">No posts yet.</p>
              ) : (
                <ul className="mt-4 space-y-6">
                  {posts.map((post) => (
                    <li
                      key={post.id}
                      className="rounded-xl border p-4"
                      style={{
                        borderColor: "color-mix(in_srgb, var(--text-main) 12%, transparent)",
                        backgroundColor: "color-mix(in_srgb, var(--text-main) 4%, transparent)",
                      }}
                    >
                      {post.title ? <p className="font-semibold">{post.title}</p> : null}
                      {post.content.trim() ? (
                        <p className="mt-1 whitespace-pre-wrap text-sm opacity-90">{post.content}</p>
                      ) : null}
                      {post.mediaUrl ? (
                        <img
                          src={post.mediaUrl}
                          alt=""
                          className="mt-3 max-h-56 w-full rounded-lg object-cover"
                          loading="lazy"
                          decoding="async"
                        />
                      ) : null}
                      {post.createdAt ? (
                        <p className="mt-2 text-xs opacity-55">
                          {Number.isNaN(new Date(post.createdAt).getTime())
                            ? post.createdAt
                            : new Date(post.createdAt).toLocaleString()}
                        </p>
                      ) : null}

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
                  ))}
                </ul>
              )}
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}
