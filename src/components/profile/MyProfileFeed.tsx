"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { chatApi, parseJwtIdentity, readAxiosErrorMessage } from "@/chat/api";
import type { PostComment, UserPost } from "@/chat/types";
import CreatePostCard from "./CreatePostCard";
import PostInteractionBar from "./PostInteractionBar";
import CommentSection from "./CommentSection";

export type MyProfileFeedProps = {
  token: string;
  className?: string;
};

function formatPostTime(iso?: string): string {
  if (!iso?.trim()) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

/**
 * Current user’s posts: loads `GET /api/posts/me`, composer, and owner edit/delete actions.
 */
export default function MyProfileFeed({ token, className = "" }: MyProfileFeedProps) {
  const [posts, setPosts] = useState<UserPost[]>([]);
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
  const { currentUserId, currentUsername } = useMemo(() => {
    const j = parseJwtIdentity(token);
    return { currentUserId: j.userId, currentUsername: j.username };
  }, [token]);

  const loadPosts = useCallback(async () => {
    setError(null);
    try {
      const list = await chatApi.getMyPosts(token);
      setPosts(list);
    } catch (e) {
      setError(readAxiosErrorMessage(e) ?? "Could not load your posts.");
      setPosts([]);
    } finally {
      setLoading(false);
    }
  }, [token]);

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
        setPosts(list);
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
  }, [token, postsIdsKey]);

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
      setPosts((prev) => prev.map((p) => (p.id === postId ? updated : p)));
      cancelEdit();
    } catch (e) {
      setError(readAxiosErrorMessage(e) ?? "Could not update post.");
    } finally {
      setSaveBusy(false);
    }
  };

  const removePost = async (postId: string) => {
    if (!window.confirm("Delete this post?")) return;
    try {
      await chatApi.deletePost(token, postId);
      setPosts((prev) => prev.filter((p) => p.id !== postId));
    } catch (e) {
      setError(readAxiosErrorMessage(e) ?? "Could not delete post.");
    }
  };

  return (
    <section className={`w-full ${className}`}>
      <div className="grid w-full gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(300px,23rem)] xl:gap-8 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="order-1 lg:order-2 lg:sticky lg:top-6 lg:self-start">
          <CreatePostCard token={token} onPosted={() => void loadPosts()} />
          <div className="mt-4 rounded-3xl border border-[var(--feed-border)] bg-[var(--feed-surface)] p-5 shadow-sm">
            <p className="text-sm font-semibold text-[var(--foreground)]">Tips</p>
            <ul className="mt-2 space-y-1 text-sm text-[var(--feed-placeholder)]">
              <li>Keep posts short and clear.</li>
              <li>Add an image for better reach.</li>
              <li>Reply to comments to build trust.</li>
            </ul>
          </div>
        </div>

      <div className="order-2 min-w-0 lg:order-1">
        <div className="flex items-end justify-between gap-3 rounded-3xl border border-[var(--feed-border)] bg-[var(--feed-surface)] px-5 py-4 shadow-sm sm:px-6">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-[var(--foreground)]">Your posts</h2>
            <p className="mt-0.5 text-sm text-[var(--feed-placeholder)]">
              A clean timeline of what you’ve shared.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadPosts()}
            className="rounded-xl border border-[var(--feed-border)] bg-[var(--feed-muted)] px-3 py-2 text-xs font-semibold text-[var(--foreground)] shadow-sm transition hover:bg-[var(--feed-surface)]"
          >
            Refresh
          </button>
        </div>
        {loading ? (
          <div className="mt-5 space-y-3">
            <div className="h-28 rounded-2xl border border-[var(--feed-border)] bg-[var(--feed-muted)]" />
            <div className="h-28 rounded-2xl border border-[var(--feed-border)] bg-[var(--feed-muted)]" />
          </div>
        ) : error ? (
          <p className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-sm dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
            {error}
          </p>
        ) : posts.length === 0 ? (
          <div className="mt-5 rounded-3xl border border-[var(--feed-border)] bg-[var(--feed-surface)] p-7 text-center shadow-sm">
            <p className="text-sm font-semibold text-[var(--foreground)]">No posts yet</p>
            <p className="mt-1 text-sm text-[var(--feed-placeholder)]">
              Use the composer to publish your first update.
            </p>
          </div>
        ) : (
          <ul className="mt-5 space-y-5">
            {posts.map((post) => {
              const isEditing = editingId === post.id;
              const comments = commentsByPostId[post.id] ?? post.comments ?? [];
              return (
                <li key={post.id} className="w-full">
                  <div
                    className="overflow-hidden rounded-3xl border border-[var(--feed-border)] bg-[var(--feed-surface)] shadow-sm"
                  >
                    <div className="flex items-center justify-between gap-3 border-b border-[var(--feed-border)] bg-gradient-to-b from-[color-mix(in_srgb,var(--feed-muted)_80%,transparent)] to-[var(--feed-surface)] px-5 py-4">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-[var(--foreground)]">
                          You
                        </p>
                        {post.createdAt ? (
                          <p className="mt-0.5 text-xs text-[var(--feed-placeholder)]">
                            {formatPostTime(post.createdAt)}
                          </p>
                        ) : (
                          <p className="mt-0.5 text-xs text-[var(--feed-placeholder)]">Draft</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                      {isEditing ? (
                        <>
                          <button
                            type="button"
                            disabled={saveBusy}
                            onClick={() => void saveEdit(post.id)}
                            className="rounded-xl bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            disabled={saveBusy}
                            onClick={cancelEdit}
                            className="rounded-xl border border-[var(--feed-border)] bg-[var(--feed-surface)] px-3 py-2 text-xs font-semibold text-[var(--foreground)] hover:bg-[var(--feed-muted)]"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => startEdit(post)}
                            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--feed-border)] bg-[var(--feed-surface)] text-slate-500 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600 dark:text-slate-300 dark:hover:border-blue-500/40 dark:hover:bg-blue-950/30 dark:hover:text-blue-300"
                            title="Edit"
                            aria-label="Edit post"
                          >
                            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden>
                              <path
                                d="M4 15.5V20h4.5L19 9.5 14.5 5 4 15.5Z"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinejoin="round"
                              />
                              <path
                                d="M12.9 6.6 17.4 11.1"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                              />
                            </svg>
                          </button>
                          <button
                            type="button"
                            onClick={() => void removePost(post.id)}
                            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--feed-border)] bg-[var(--feed-surface)] text-slate-500 transition hover:border-red-300 hover:bg-red-50 hover:text-red-600 dark:text-slate-300 dark:hover:border-red-500/40 dark:hover:bg-red-950/30 dark:hover:text-red-300"
                            title="Delete"
                            aria-label="Delete post"
                          >
                            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden>
                              <path
                                d="M5 7h14"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                              />
                              <path
                                d="M9.5 7V5.8A1.8 1.8 0 0 1 11.3 4h1.4a1.8 1.8 0 0 1 1.8 1.8V7"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                              />
                              <path
                                d="M8 7l.7 11.2c.05.92.8 1.8 1.8 1.8h3c1 0 1.75-.88 1.8-1.8L16 7"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinejoin="round"
                              />
                              <path
                                d="M10.6 10.2v6.2M13.4 10.2v6.2"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                              />
                            </svg>
                          </button>
                        </>
                      )}
                    </div>
                    </div>

                    {isEditing ? (
                      <div className="space-y-3 px-5 py-4">
                        <input
                          type="text"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          placeholder="Title (optional)"
                          className="w-full rounded-2xl border border-[var(--feed-border)] bg-[var(--feed-muted)] px-4 py-3 text-sm text-[var(--foreground)] placeholder:text-[var(--feed-placeholder)]"
                        />
                        <textarea
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          rows={4}
                          className="w-full resize-y rounded-2xl border border-[var(--feed-border)] bg-[var(--feed-muted)] px-4 py-3 text-sm text-[var(--foreground)] placeholder:text-[var(--feed-placeholder)]"
                        />
                      </div>
                    ) : (
                      <>
                        <div className="px-5 py-4">
                          {post.title ? (
                            <p className="text-base font-semibold leading-snug text-[var(--foreground)]">
                              {post.title}
                            </p>
                          ) : null}
                          {post.content.trim() ? (
                            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-[var(--foreground)]">
                              {post.content}
                            </p>
                          ) : null}
                        </div>
                        {post.mediaUrl ? (
                          <img
                            src={post.mediaUrl}
                            alt=""
                            className="max-h-[min(70vh,56rem)] w-full object-cover"
                            loading="lazy"
                            decoding="async"
                          />
                        ) : null}

                        <PostInteractionBar
                          token={token}
                          postId={post.id}
                          initialReactionCount={post.reactionCount ?? 0}
                          initialCommentCount={
                            comments.length > 0 ? comments.length : post.commentCount ?? 0
                          }
                          initialMyReaction={post.myReaction ?? null}
                          className="px-5 pb-4"
                          commentSectionId={`comments-${post.id}`}
                        />

                        {(post.commentCount ?? 0) > 0 && comments.length === 0 ? (
                          <div className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-white/10 px-3 py-2">
                            <p className="text-xs opacity-90">
                              {post.commentCount} comment{post.commentCount === 1 ? "" : "s"}
                            </p>
                            <button
                              type="button"
                              onClick={() => void loadCommentsForPost(post.id)}
                              className="rounded-md bg-white/15 px-2.5 py-1 text-xs font-semibold hover:bg-white/25"
                            >
                              View comments
                            </button>
                          </div>
                        ) : null}
                        {commentLoadErrorByPostId[post.id] ? (
                          <p className="mt-2 text-xs text-amber-200">{commentLoadErrorByPostId[post.id]}</p>
                        ) : null}

                        <div id={`comments-${post.id}`} className="px-5 pb-5">
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
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      </div>
    </section>
  );
}
