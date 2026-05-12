"use client";

import { useState } from "react";
import { chatApi, readAxiosErrorMessage } from "@/chat/api";
import { SafeRemoteImage } from "@/components/ui/SafeRemoteImage";
import type { PostComment } from "@/chat/types";

export type CommentSectionProps = {
  postId: string;
  /** Bearer token; when empty, the composer is hidden. */
  token: string;
  currentUserId?: string | null;
  /** Login username (e.g. JWT `sub`) when numeric id is unavailable for ownership checks. */
  currentUsername?: string | null;
  /** Controlled list (e.g. lifted to the profile page for the post being viewed). */
  comments: PostComment[];
  onCommentsChange: (next: PostComment[]) => void;
  /** If the API does not return the new comment, the optimistic row uses these. */
  currentUserDisplayName?: string;
  currentUserAvatarUrl?: string | null;
  className?: string;
};

function formatTime(iso?: string): string {
  if (!iso?.trim()) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}

/**
 * Post comments list + fixed composer. Theming: `--bg-main`, `--text-main` (see `globals.css`).
 * Uses `POST /api/posts/{postId}/comments` with the given `postId`.
 */
export default function CommentSection({
  postId,
  token,
  currentUserId = null,
  currentUsername = null,
  comments,
  onCommentsChange,
  currentUserDisplayName = "You",
  currentUserAvatarUrl = null,
  className = "",
}: CommentSectionProps) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [replyBusyFor, setReplyBusyFor] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [editingFor, setEditingFor] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [editBusyFor, setEditBusyFor] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PostComment | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authenticated = Boolean(token?.trim());

  const submit = async () => {
    const text = draft.trim();
    if (!text || !authenticated) return;
    setBusy(true);
    setError(null);
    try {
      const result = await chatApi.addCommentToPost(token, postId, text);
      const now = new Date().toISOString();
      const next: PostComment =
        result.comment != null
          ? {
              ...result.comment,
              authorId: result.comment.authorId ?? currentUserId ?? undefined,
            }
          : ({
              id: `local-${Date.now()}`,
              content: text,
              displayName: currentUserDisplayName,
              avatarUrl: currentUserAvatarUrl,
              createdAt: now,
              authorId: currentUserId ?? undefined,
            } satisfies PostComment);
      onCommentsChange([...comments, next]);
      setDraft("");
    } catch (e) {
      setError(readAxiosErrorMessage(e) ?? "Could not post comment.");
    } finally {
      setBusy(false);
    }
  };

  const submitReply = async (parentCommentId: string) => {
    const text = replyDraft.trim();
    if (!text || !authenticated) return;
    setReplyBusyFor(parentCommentId);
    setError(null);
    try {
      const result = await chatApi.addCommentToPost(token, postId, text, parentCommentId);
      const now = new Date().toISOString();
      const next: PostComment =
        result.comment != null
          ? {
              ...result.comment,
              authorId: result.comment.authorId ?? currentUserId ?? undefined,
              parentCommentId: result.comment.parentCommentId ?? parentCommentId,
            }
          : ({
              id: `local-reply-${Date.now()}`,
              content: text,
              displayName: currentUserDisplayName,
              avatarUrl: currentUserAvatarUrl,
              createdAt: now,
              parentCommentId,
              authorId: currentUserId ?? undefined,
            } satisfies PostComment);
      onCommentsChange([...comments, next]);
      setReplyDraft("");
      setReplyTo(null);
    } catch (e) {
      setError(readAxiosErrorMessage(e) ?? "Could not post reply.");
    } finally {
      setReplyBusyFor(null);
    }
  };

  const topLevelComments = comments.filter((c) => !c.parentCommentId);
  const repliesByParent: Record<string, PostComment[]> = {};
  for (const c of comments) {
    if (!c.parentCommentId) continue;
    const key = String(c.parentCommentId);
    (repliesByParent[key] ??= []).push(c);
  }

  const isOwner = (c: PostComment): boolean => {
    const uid = currentUserId?.trim() ?? "";
    const uname = currentUsername?.trim().toLowerCase() ?? "";
    if (!uid && !uname) return false;
    const aid = c.authorId != null ? String(c.authorId).trim() : "";
    if (uid && aid && aid === uid) return true;
    const mine = currentUserDisplayName?.trim().toLowerCase();
    const label = c.displayName?.trim().toLowerCase();
    if (mine && label && mine === label) return true;
    if (uname && label && uname === label) return true;
    return false;
  };

  const startEdit = (c: PostComment): void => {
    setMenuFor(null);
    setEditingFor(c.id);
    setEditDraft(c.content);
  };

  const cancelEdit = (): void => {
    setEditingFor(null);
    setEditDraft("");
  };

  const saveEdit = async (c: PostComment): Promise<void> => {
    const text = editDraft.trim();
    if (!text) return;
    setEditBusyFor(c.id);
    setError(null);
    try {
      const updated = await chatApi.updatePostComment(token, postId, c.id, text);
      onCommentsChange(
        comments.map((x) =>
          x.id === c.id
            ? {
                ...x,
                content: text,
                ...(updated ?? {}),
                id: x.id,
                parentCommentId: x.parentCommentId ?? updated?.parentCommentId,
              }
            : x
        )
      );
      cancelEdit();
    } catch (e) {
      setError(readAxiosErrorMessage(e) ?? "Could not update comment.");
    } finally {
      setEditBusyFor(null);
    }
  };

  const confirmDelete = async (): Promise<void> => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setError(null);
    try {
      await chatApi.deletePostComment(token, postId, deleteTarget.id);
      const targetId = deleteTarget.id;
      onCommentsChange(
        comments.filter((x) => x.id !== targetId && x.parentCommentId !== targetId)
      );
      setDeleteTarget(null);
      setMenuFor(null);
    } catch (e) {
      setError(readAxiosErrorMessage(e) ?? "Could not delete comment.");
    } finally {
      setDeleteBusy(false);
    }
  };

  const CommentBody = ({ c }: { c: PostComment }) => (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-sm font-semibold">{c.displayName}</span>
        {c.createdAt ? <span className="text-xs opacity-60">{formatTime(c.createdAt)}</span> : null}

        {isOwner(c) ? (
          <div className="relative ml-auto">
            <button
              type="button"
              className="rounded-md px-1.5 py-0.5 text-xs opacity-70 hover:bg-[color-mix(in_srgb,var(--text-main)_8%,transparent)] hover:opacity-100"
              aria-label="Comment actions"
              onClick={() => setMenuFor((prev) => (prev === c.id ? null : c.id))}
            >
              …
            </button>
            {menuFor === c.id ? (
              <div className="absolute right-0 top-6 z-20 min-w-[130px] overflow-hidden rounded-xl border border-[color-mix(in_srgb,var(--text-main)_18%,transparent)] bg-[var(--bg-main)] shadow-xl">
                <button
                  type="button"
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-[color-mix(in_srgb,var(--text-main)_6%,transparent)]"
                  onClick={() => startEdit(c)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="block w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-[color-mix(in_srgb,var(--text-main)_6%,transparent)] dark:text-red-400"
                  onClick={() => {
                    setMenuFor(null);
                    setDeleteTarget(c);
                  }}
                >
                  Delete
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {editingFor === c.id ? (
        <div className="mt-2 space-y-2">
          <input
            type="text"
            value={editDraft}
            onChange={(e) => setEditDraft(e.target.value)}
            className="w-full rounded-lg border border-[color-mix(in_srgb,var(--text-main)_18%,transparent)] bg-[color-mix(in_srgb,var(--text-main)_5%,transparent)] px-3 py-2 text-sm outline-none"
            style={{ color: "var(--text-main)" }}
            disabled={editBusyFor === c.id}
            onKeyDown={(e) => {
              if (e.key === "Enter") void saveEdit(c);
            }}
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
              disabled={editBusyFor === c.id || !editDraft.trim()}
              onClick={() => void saveEdit(c)}
            >
              {editBusyFor === c.id ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              className="rounded-lg border border-[color-mix(in_srgb,var(--text-main)_18%,transparent)] px-3 py-1.5 text-xs font-semibold hover:bg-[color-mix(in_srgb,var(--text-main)_6%,transparent)]"
              disabled={editBusyFor === c.id}
              onClick={cancelEdit}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed opacity-90">{c.content}</p>
      )}

      {authenticated && editingFor !== c.id ? (
        <button
          type="button"
          className="mt-1 text-xs font-semibold text-blue-600 hover:underline dark:text-blue-400"
          onClick={() => {
            setReplyTo((prev) => (prev === c.id ? null : c.id));
            setReplyDraft("");
          }}
        >
          {replyTo === c.id ? "Cancel" : "Reply"}
        </button>
      ) : null}
    </div>
  );

  return (
    <div
      className={`flex flex-col overflow-hidden rounded-2xl border border-[color-mix(in_srgb,var(--text-main)_14%,transparent)] ${className}`}
      style={{
        backgroundColor: "var(--bg-main)",
        color: "var(--text-main)",
      }}
    >
      <div className="max-h-80 min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {comments.length === 0 ? (
          <p className="text-center text-sm opacity-70">No comments yet.</p>
        ) : (
          topLevelComments.map((c) => {
            const initial = (c.displayName || "?").slice(0, 1).toUpperCase();
            const replies = repliesByParent[c.id] ?? [];
            return (
              <div key={c.id}>
                <div className="flex gap-3">
                  <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full border border-[color-mix(in_srgb,var(--text-main)_12%,transparent)] bg-[color-mix(in_srgb,var(--text-main)_6%,transparent)] shadow-sm">
                    {c.avatarUrl?.trim() ? (
                      <SafeRemoteImage
                        src={c.avatarUrl}
                        alt=""
                        className="h-full w-full object-cover"
                        variant="avatar"
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-sm font-semibold opacity-80">
                        {initial}
                      </span>
                    )}
                  </div>
                  <CommentBody c={c} />
                </div>

                {replyTo === c.id ? (
                  <div className="mt-2 ml-[52px] flex gap-2">
                    <input
                      type="text"
                      value={replyDraft}
                      onChange={(e) => setReplyDraft(e.target.value)}
                      placeholder={`Reply to ${c.displayName}...`}
                      disabled={replyBusyFor === c.id}
                      className="min-w-0 flex-1 rounded-lg border border-[color-mix(in_srgb,var(--text-main)_16%,transparent)] bg-[color-mix(in_srgb,var(--text-main)_5%,transparent)] px-3 py-2 text-sm outline-none"
                      style={{ color: "var(--text-main)" }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void submitReply(c.id);
                      }}
                    />
                    <button
                      type="button"
                      disabled={replyBusyFor === c.id || !replyDraft.trim()}
                      onClick={() => void submitReply(c.id)}
                      className="shrink-0 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
                    >
                      {replyBusyFor === c.id ? "…" : "Reply"}
                    </button>
                  </div>
                ) : null}

                {replies.length > 0 ? (
                  <div className="ml-[52px] mt-2 space-y-2 border-l border-[color-mix(in_srgb,var(--text-main)_16%,transparent)] pl-3">
                    {replies.map((r) => {
                      const rInitial = (r.displayName || "?").slice(0, 1).toUpperCase();
                      return (
                        <div key={r.id} className="flex gap-2.5 rounded-lg bg-[color-mix(in_srgb,var(--text-main)_4%,transparent)] px-2.5 py-2">
                          <div className="h-7 w-7 shrink-0 overflow-hidden rounded-full border border-[color-mix(in_srgb,var(--text-main)_12%,transparent)]">
                            {r.avatarUrl?.trim() ? (
                              <SafeRemoteImage
                                src={r.avatarUrl}
                                alt=""
                                className="h-full w-full object-cover"
                                variant="avatar"
                                loading="lazy"
                                decoding="async"
                              />
                            ) : (
                              <span className="flex h-full w-full items-center justify-center text-[11px] font-semibold opacity-80">
                                {rInitial}
                              </span>
                            )}
                          </div>
                          <CommentBody c={r} />
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>

      {authenticated ? (
        <div className="border-t border-[color-mix(in_srgb,var(--text-main)_12%,transparent)] bg-[color-mix(in_srgb,var(--text-main)_3%,transparent)] p-3">
          {error ? (
            <p className="mb-2 text-center text-xs text-red-600 dark:text-red-400">{error}</p>
          ) : null}
          <div className="flex gap-2">
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Write a comment…"
              disabled={busy}
              className="min-w-0 flex-1 rounded-xl border border-[color-mix(in_srgb,var(--text-main)_16%,transparent)] bg-[color-mix(in_srgb,var(--text-main)_5%,transparent)] px-3 py-2.5 text-sm outline-none ring-offset-2 transition focus:ring-2 focus:ring-[color-mix(in_srgb,var(--text-main)_35%,transparent)]"
              style={{ color: "var(--text-main)" }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
            />
            <button
              type="button"
              disabled={busy || !draft.trim()}
              onClick={() => void submit()}
              className="shrink-0 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-40"
            >
              {busy ? "…" : "Send"}
            </button>
          </div>
        </div>
      ) : (
        <p className="border-t border-[color-mix(in_srgb,var(--text-main)_12%,transparent)] p-3 text-center text-sm opacity-70">
          Sign in to comment.
        </p>
      )}

      {deleteTarget ? (
        <div
          className="fixed inset-0 z-[130] flex items-center justify-center bg-black/45 p-4"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setDeleteTarget(null);
          }}
        >
          <div
            className="w-full max-w-sm rounded-2xl border p-5 shadow-xl"
            style={{
              backgroundColor: "var(--bg-main)",
              color: "var(--text-main)",
              borderColor: "color-mix(in_srgb, var(--text-main) 16%, transparent)",
            }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-comment-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h3 id="delete-comment-title" className="text-lg font-semibold">
              Delete comment?
            </h3>
            <p className="mt-2 text-sm opacity-75">
              This action cannot be undone.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-[color-mix(in_srgb,var(--text-main)_6%,transparent)]"
                style={{ borderColor: "color-mix(in_srgb, var(--text-main) 16%, transparent)" }}
                disabled={deleteBusy}
                onClick={() => setDeleteTarget(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-40"
                disabled={deleteBusy}
                onClick={() => void confirmDelete()}
              >
                {deleteBusy ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
