"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { chatApi, parseJwtIdentity, readAxiosErrorMessage } from "@/chat/api";
import { normalizeBackendTimestamp } from "@/chat/normalizeBackendTimestamp";
import type { PostComment, UserPost, UserSummary } from "@/chat/types";
import CreatePostCard from "./CreatePostCard";
import PostInteractionBar from "./PostInteractionBar";
import CommentSection from "./CommentSection";
import { PostContentWithHashtags } from "./postContentRich";
import { SafeRemoteImage } from "@/components/ui/SafeRemoteImage";

export type MyProfileFeedProps = {
  token: string;
  className?: string;
  viewerAvatarUrl?: string | null;
  viewerDisplayName?: string | null;
  /** `me` = only your posts; `news` = your posts + direct-chat peers. */
  mode?: "me" | "news";
  /** Peer users for `news` mode. */
  newsUsers?: UserSummary[];
};

type FeedPost = UserPost & {
  ownerUserId: string | null;
  ownerUsername?: string | null;
  ownerName: string;
  ownerAvatarUrl?: string | null;
  mine: boolean;
};

const EMPTY_USERS: UserSummary[] = [];

function postRelativeLabel(iso?: string): string {
  const raw = iso?.trim();
  if (!raw) return "";
  const normalized = normalizeBackendTimestamp(raw) ?? raw;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return "";
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const day = Math.floor(h / 24);
  if (day < 14) return `${day}d ago`;
  return d.toLocaleDateString();
}

function postMetaLine(iso?: string): string {
  const rel = postRelativeLabel(iso);
  return rel ? `${rel} · Feed` : "Draft";
}

/**
 * Current user’s posts: loads `GET /api/posts/me`, composer, and owner edit/delete actions.
 */
export default function MyProfileFeed({
  token,
  className = "",
  viewerAvatarUrl,
  viewerDisplayName,
  mode = "me",
  newsUsers,
}: MyProfileFeedProps) {
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [saveBusy, setSaveBusy] = useState(false);
  const [commentsByPostId, setCommentsByPostId] = useState<Record<string, PostComment[]>>({});
  const [commentLoadErrorByPostId, setCommentLoadErrorByPostId] = useState<Record<string, string>>(
    {}
  );
  const [openMenuPostId, setOpenMenuPostId] = useState<string | null>(null);
  const { currentUserId, currentUsername } = useMemo(() => {
    const j = parseJwtIdentity(token);
    return { currentUserId: j.userId, currentUsername: j.username };
  }, [token]);
  const stableNewsUsers = newsUsers ?? EMPTY_USERS;

  const mapMinePost = useCallback(
    (post: UserPost): FeedPost => ({
      ...post,
      ownerUserId: currentUserId,
      ownerUsername: currentUsername,
      ownerName: (viewerDisplayName ?? "").trim() || (currentUsername ?? "").trim() || "You",
      ownerAvatarUrl: viewerAvatarUrl ?? null,
      mine: true,
    }),
    [currentUserId, currentUsername, viewerAvatarUrl, viewerDisplayName]
  );

  const loadPosts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const mine = (await chatApi.getMyPosts(token)).map(mapMinePost);
      if (mode === "me" || stableNewsUsers.length === 0) {
        setPosts(mine);
      } else {
        const peerLists = await Promise.all(
          stableNewsUsers.map(async (u) => {
            try {
              const list = await chatApi.getPostsByUserId(token, u.id);
              return list.map<FeedPost>((post) => ({
                ...post,
                ownerUserId: u.id,
                ownerUsername: u.username,
                ownerName: u.displayName?.trim() || u.username,
                ownerAvatarUrl: u.avatarUrl ?? null,
                mine: false,
              }));
            } catch {
              return [] as FeedPost[];
            }
          })
        );
        const merged = [...mine, ...peerLists.flat()].sort((a, b) => {
          const at = a.createdAt ? Date.parse(a.createdAt) : 0;
          const bt = b.createdAt ? Date.parse(b.createdAt) : 0;
          return bt - at;
        });
        setPosts(merged);
      }
    } catch (e) {
      setError(readAxiosErrorMessage(e) ?? "Could not load feed.");
      setPosts([]);
    } finally {
      setLoading(false);
    }
  }, [mapMinePost, mode, stableNewsUsers, token]);

  useEffect(() => {
    void loadPosts();
  }, [loadPosts]);

  const postsIdsKey = useMemo(() => posts.map((p) => p.id).join("|"), [posts]);

  const loadCommentsForPost = useCallback(
    async (postId: string): Promise<void> => {
      try {
        const list = await chatApi.getPostComments(token, postId);
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
    },
    [token]
  );

  /** Keep comment threads reasonably fresh so other users’ comments appear. */
  useEffect(() => {
    if (!token || posts.length === 0) return;
    let cancelled = false;

    const refresh = async (): Promise<void> => {
      if (cancelled) return;
      try {
        const list = await chatApi.getMyPosts(token);
        if (cancelled) return;
        setPosts((prev) => {
          const byId = new Map(prev.map((p) => [p.id, p]));
          const nextMine = list.map(mapMinePost);
          if (mode === "me") return nextMine;
          // Keep non-mine rows and refresh mine rows.
          const others = prev.filter((p) => !p.mine);
          const merged = [...nextMine, ...others].sort((a, b) => {
            const at = a.createdAt
              ? Date.parse(normalizeBackendTimestamp(a.createdAt) ?? a.createdAt)
              : 0;
            const bt = b.createdAt
              ? Date.parse(normalizeBackendTimestamp(b.createdAt) ?? b.createdAt)
              : 0;
            return bt - at;
          });
          for (const p of merged) {
            const prevP = byId.get(p.id);
            if (prevP?.comments && !p.comments) p.comments = prevP.comments;
          }
          return merged;
        });
      } catch {
        /* ignore */
      }

      await Promise.all(
        posts.map(async (p) => {
          const loaded = (commentsByPostId[p.id] ?? []).length > 0;
          const shouldTry = loaded || (p.commentCount ?? 0) > 0;
          if (!shouldTry) return;
          try {
            const list = await chatApi.getPostComments(token, p.id);
            if (!cancelled) setCommentsByPostId((prev) => ({ ...prev, [p.id]: list }));
          } catch {
            /* ignore */
          }
        })
      );
    };

    const onVisible = (): void => {
      if (document.visibilityState !== "visible") return;
      void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    const t = window.setInterval(() => void refresh(), 15000);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, postsIdsKey, mapMinePost, mode]);

  useEffect(() => {
    if (!openMenuPostId) return;
    const onDoc = (e: MouseEvent) => {
      const root = document.getElementById(`post-menu-root-${openMenuPostId}`);
      if (root?.contains(e.target as Node)) return;
      setOpenMenuPostId(null);
    };
    const tid = window.setTimeout(() => document.addEventListener("mousedown", onDoc), 0);
    return () => {
      window.clearTimeout(tid);
      document.removeEventListener("mousedown", onDoc);
    };
  }, [openMenuPostId]);

  const viewerLabel =
    (viewerDisplayName ?? "").trim() ||
    (currentUsername ?? "").trim() ||
    "You";
  const viewerInitial = viewerLabel.slice(0, 1).toUpperCase();

  const startEdit = (post: UserPost) => {
    setEditingId(post.id);
    setEditContent(post.content);
    setEditTitle(post.title ?? "");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditContent("");
    setEditTitle("");
  };

  const saveEdit = async (postId: string) => {
    setSaveBusy(true);
    try {
      const updated = await chatApi.updatePost(token, postId, {
        content: editContent.trim(),
        title: editTitle.trim() || undefined,
      });
      setPosts((prev) =>
        prev.map((p) => (p.id === postId ? { ...p, ...updated } : p))
      );
      cancelEdit();
    } catch (e) {
      setError(readAxiosErrorMessage(e) ?? "Could not update post.");
    } finally {
      setSaveBusy(false);
    }
  };

  const removePost = async (postId: string) => {
    setOpenMenuPostId(null);
    if (!window.confirm("Delete this post?")) return;
    try {
      await chatApi.deletePost(token, postId);
      setPosts((prev) => prev.filter((p) => p.id !== postId));
    } catch (e) {
      setError(readAxiosErrorMessage(e) ?? "Could not delete post.");
    }
  };

  return (
    <section className={`w-full space-y-3 ${className}`}>
      <CreatePostCard
        token={token}
        onPosted={() => void loadPosts()}
        composerAvatarUrl={viewerAvatarUrl}
        composerName={viewerDisplayName ?? currentUsername}
      />

      <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200/90 bg-white px-4 py-3 shadow-sm dark:border-slate-600 dark:bg-slate-900 sm:px-5">
        <div>
          <h2 className="text-base font-bold tracking-tight text-slate-900 dark:text-slate-100">
            {mode === "news" ? "News feed" : "Your posts"}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {mode === "news" ? "Posts from friends and you" : "Updates you have shared"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadPosts()}
          className="rounded-xl border border-slate-200 bg-[#f4f1eb] px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-[#ebe6dc] dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="space-y-3">
          <div className="h-32 rounded-2xl border border-slate-200/90 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800/50" />
          <div className="h-32 rounded-2xl border border-slate-200/90 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800/50" />
        </div>
      ) : error ? (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          {error}
        </p>
      ) : posts.length === 0 ? (
        <div className="rounded-2xl border border-slate-200/90 bg-white p-8 text-center shadow-sm dark:border-slate-600 dark:bg-slate-900">
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">No posts yet</p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {mode === "news"
              ? "Add friends to see their posts here."
              : "Use Create Post above to share an update."}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {posts.map((post) => {
            const isEditing = editingId === post.id;
            const comments = commentsByPostId[post.id] ?? post.comments ?? [];
            const profileHref = post.ownerUsername?.trim()
              ? `/users/${encodeURIComponent(post.ownerUsername.trim())}`
              : null;
            return (
              <li key={post.id} className="w-full">
                <article className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm dark:border-slate-600 dark:bg-slate-900">
                  <div className="flex items-start gap-3 p-4">
                    {profileHref ? (
                      <Link
                        href={profileHref}
                        className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full border border-slate-200 bg-slate-100 transition hover:opacity-90 dark:border-slate-600 dark:bg-slate-800"
                        aria-label={`Open ${post.ownerName || viewerLabel} profile`}
                      >
                        {post.ownerAvatarUrl ? (
                          <SafeRemoteImage
                            src={post.ownerAvatarUrl}
                            alt=""
                            className="h-full w-full object-cover"
                            variant="avatar"
                            loading="lazy"
                            decoding="async"
                          />
                        ) : (
                          <span className="flex h-full w-full items-center justify-center text-sm font-semibold text-slate-600 dark:text-slate-300">
                            {(post.ownerName || viewerLabel).slice(0, 1).toUpperCase() || viewerInitial}
                          </span>
                        )}
                      </Link>
                    ) : (
                      <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full border border-slate-200 bg-slate-100 dark:border-slate-600 dark:bg-slate-800">
                        {post.ownerAvatarUrl ? (
                          <SafeRemoteImage
                            src={post.ownerAvatarUrl}
                            alt=""
                            className="h-full w-full object-cover"
                            variant="avatar"
                            loading="lazy"
                            decoding="async"
                          />
                        ) : (
                          <span className="flex h-full w-full items-center justify-center text-sm font-semibold text-slate-600 dark:text-slate-300">
                            {(post.ownerName || viewerLabel).slice(0, 1).toUpperCase() || viewerInitial}
                          </span>
                        )}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      {profileHref ? (
                        <Link
                          href={profileHref}
                          className="block truncate font-semibold text-slate-900 transition hover:underline dark:text-slate-100"
                        >
                          {post.ownerName || viewerLabel}
                        </Link>
                      ) : (
                        <p className="truncate font-semibold text-slate-900 dark:text-slate-100">
                          {post.ownerName || viewerLabel}
                        </p>
                      )}
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        {postMetaLine(post.createdAt)}
                      </p>
                    </div>
                    <div className="relative shrink-0" id={`post-menu-root-${post.id}`}>
                      {isEditing && post.mine ? (
                        <div className="flex gap-1">
                          <button
                            type="button"
                            disabled={saveBusy}
                            onClick={() => void saveEdit(post.id)}
                            className="rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            disabled={saveBusy}
                            onClick={cancelEdit}
                            className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : post.mine ? (
                        <>
                          <button
                            type="button"
                            className="rounded-lg p-2 text-lg leading-none text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                            aria-label="Post options"
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenMenuPostId((prev: string | null) =>
                                prev === post.id ? null : post.id
                              );
                            }}
                          >
                            ⋯
                          </button>
                          {openMenuPostId === post.id ? (
                            <div
                              className="absolute right-0 z-20 mt-1 w-36 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-600 dark:bg-slate-800"
                              onClick={(e) => e.stopPropagation()}
                              role="menu"
                            >
                              <button
                                type="button"
                                role="menuitem"
                                className="block w-full px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-50 dark:text-slate-100 dark:hover:bg-slate-700/80"
                                onClick={() => {
                                  startEdit(post);
                                  setOpenMenuPostId(null);
                                }}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                className="block w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
                                onClick={() => {
                                  setOpenMenuPostId(null);
                                  void removePost(post.id);
                                }}
                              >
                                Delete
                              </button>
                            </div>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  </div>

                  {isEditing ? (
                    <div className="space-y-3 border-t border-slate-100 px-4 py-4 dark:border-slate-700">
                      <input
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        placeholder="Title (optional)"
                        className="w-full rounded-xl border border-slate-200 bg-[#f4f1eb] px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                      />
                      <textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        rows={4}
                        className="w-full resize-y rounded-xl border border-slate-200 bg-[#f4f1eb] px-4 py-3 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                      />
                    </div>
                  ) : (
                    <>
                      <div className="px-4 pb-3">
                        {post.title ? (
                          <p className="text-base font-semibold leading-snug text-slate-900 dark:text-slate-100">
                            {post.title}
                          </p>
                        ) : null}
                        {post.content.trim() ? (
                          <PostContentWithHashtags
                            text={post.content}
                            className="mt-1 whitespace-pre-wrap text-[15px] leading-relaxed text-slate-900 dark:text-slate-100"
                          />
                        ) : null}
                      </div>
                      {post.mediaUrl ? (
                        <SafeRemoteImage
                          src={post.mediaUrl}
                          alt=""
                          className="max-h-[min(70vh,56rem)] w-full object-cover"
                          variant="cover"
                          loading="lazy"
                          decoding="async"
                        />
                      ) : null}

                      <PostInteractionBar
                        token={token}
                        postId={post.id}
                        initialReactionCount={post.reactionCount ?? 0}
                        initialReactionSummary={post.reactionSummary ?? null}
                        initialCommentCount={
                          comments.length > 0 ? comments.length : post.commentCount ?? 0
                        }
                        initialMyReaction={post.myReaction ?? null}
                        className="px-4"
                        commentSectionId={`comments-${post.id}`}
                      />

                      {(post.commentCount ?? 0) > 0 && comments.length === 0 ? (
                        <div className="mx-4 mb-2 flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/60">
                          <p className="text-xs text-slate-600 dark:text-slate-400">
                            {post.commentCount} comment{post.commentCount === 1 ? "" : "s"}
                          </p>
                          <button
                            type="button"
                            onClick={() => void loadCommentsForPost(post.id)}
                            className="rounded-md bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-600"
                          >
                            View comments
                          </button>
                        </div>
                      ) : null}
                      {commentLoadErrorByPostId[post.id] ? (
                        <p className="px-4 pb-2 text-xs text-amber-700 dark:text-amber-300">
                          {commentLoadErrorByPostId[post.id]}
                        </p>
                      ) : null}

                      <div id={`comments-${post.id}`} className="border-t border-slate-100 px-4 pb-4 pt-2 dark:border-slate-700">
                        <CommentSection
                          postId={post.id}
                          token={token}
                          currentUserId={currentUserId}
                          currentUsername={currentUsername}
                          comments={comments}
                          onCommentsChange={(next) => {
                            setCommentsByPostId((prev) => ({ ...prev, [post.id]: next }));
                          }}
                        />
                      </div>
                    </>
                  )}
                </article>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
