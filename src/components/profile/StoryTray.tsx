"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { chatApi, parseJwtIdentity, readAxiosErrorMessage } from "@/chat/api";
import type { Story } from "@/chat/types";
import { getImageUrl } from "@/utils/getImageUrl";
import { SafeRemoteImage } from "@/components/ui/SafeRemoteImage";
import StoryEditorModal from "./StoryEditorModal";

/**
 * Story timestamps from the backend are local ISO strings like
 * `2026-05-13T16:08:55.630134`. Parse them directly so the browser treats them
 * as local time and we never end up with a future date when there's no `Z` /
 * offset. Always show minute precision (no "Just now") and floor any clock
 * drift to `1m ago` so the label never reads as zero.
 */
function storyRelativeLabel(iso?: string | null): string {
  const raw = iso?.trim();
  if (!raw) return "";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "";
  const diffMs = new Date().getTime() - d.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) {
    const safe = minutes <= 0 ? 1 : minutes;
    return `${safe}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}

export type StoryTrayProps = {
  token: string;
  /** The signed-in user's id. Used to gate delete and group own stories. */
  currentUserId: string | null;
  /** Viewer avatar used as the fallback background of the +Add card. */
  viewerAvatarUrl?: string | null;
};

type Viewer = {
  label: string;
  avatarSrc: string | undefined;
  stories: Story[];
  index: number;
};

const TEAL = "#1E7F73";
const AUTO_CLOSE_MS = 5000;

export default function StoryTray({
  token,
  currentUserId: currentUserIdProp,
  viewerAvatarUrl,
}: StoryTrayProps) {
  // Resolve the viewer's numeric user id with a three-tier fallback:
  //   1) prop from parent (most apps set it after login).
  //   2) JWT claims — userId/uid/etc, then a numeric `sub`.
  //   3) `GET /api/users/me` — last resort when `sub` is the username string.
  // Required because `story.userId` is the numeric id, so any non-numeric
  // identifier here would silently drop us into the friend-card path and hide
  // the delete button on our own stories.
  const jwtUserId = useMemo<string | null>(() => {
    if (currentUserIdProp?.trim()) return currentUserIdProp.trim();
    if (!token) return null;
    const j = parseJwtIdentity(token);
    if (j.userId?.trim()) return j.userId.trim();
    if (j.username && /^\d+$/.test(j.username.trim())) return j.username.trim();
    return null;
  }, [currentUserIdProp, token]);

  const [resolvedSelfId, setResolvedSelfId] = useState<string | null>(null);

  useEffect(() => {
    if (!token || jwtUserId) return;
    let cancelled = false;
    (async () => {
      try {
        const me = await chatApi.getMyProfile(token);
        if (cancelled) return;
        if (me.id) setResolvedSelfId(String(me.id));
      } catch {
        /* ignore — delete UI will simply remain hidden */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, jwtUserId]);

  const currentUserId = jwtUserId ?? resolvedSelfId;

  const [stories, setStories] = useState<Story[]>([]);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [editorFile, setEditorFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadFeed = useCallback(async () => {
    if (!token) return;
    try {
      const [feedResult, ownResult] = await Promise.allSettled([
        chatApi.getStoriesFeed(token),
        currentUserId
          ? chatApi.getStoriesByUserId(token, currentUserId)
          : Promise.resolve([] as Story[]),
      ]);
      if (feedResult.status === "rejected" && ownResult.status === "rejected") {
        throw feedResult.reason;
      }
      const feed = feedResult.status === "fulfilled" ? feedResult.value : [];
      const own = ownResult.status === "fulfilled" ? ownResult.value : [];

      // `/api/stories/feed` returns only the latest story per friend. Fan out to
      // `/api/stories/user/{id}` for each unique friend so the tray badge and
      // viewer playlist see the full list, not just the newest entry.
      const friendUserIds = new Set<string>();
      for (const s of feed) {
        if (!s.userId) continue;
        const uid = String(s.userId);
        if (currentUserId && uid === String(currentUserId)) continue;
        friendUserIds.add(uid);
      }
      const friendResults =
        friendUserIds.size === 0
          ? []
          : await Promise.allSettled(
              Array.from(friendUserIds).map((uid) =>
                chatApi.getStoriesByUserId(token, uid)
              )
            );

      const byId = new Map<string, Story>();
      for (const s of feed) byId.set(s.id, s);
      for (const s of own) byId.set(s.id, s);
      for (const r of friendResults) {
        if (r.status === "fulfilled") {
          for (const s of r.value) byId.set(s.id, s);
        }
      }
      setStories(Array.from(byId.values()));
    } catch (e) {
      setError(readAxiosErrorMessage(e) ?? "Could not load stories.");
    }
  }, [token, currentUserId]);

  useEffect(() => {
    void loadFeed();
  }, [loadFeed]);

  const advanceOrClose = useCallback(() => {
    setViewer((cur) => {
      if (!cur) return null;
      if (cur.index < cur.stories.length - 1) return { ...cur, index: cur.index + 1 };
      return null;
    });
  }, []);

  const goBack = useCallback(() => {
    setViewer((cur) => {
      if (!cur) return null;
      if (cur.index > 0) return { ...cur, index: cur.index - 1 };
      return cur;
    });
  }, []);

  useEffect(() => {
    if (!viewer || deleteBusy) return;
    const timer = window.setTimeout(advanceOrClose, AUTO_CLOSE_MS);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setViewer(null);
      else if (e.key === "ArrowLeft") goBack();
      else if (e.key === "ArrowRight") advanceOrClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
    };
  }, [viewer, deleteBusy, advanceOrClose, goBack]);

  const onPickFile = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setError(null);
    setEditorFile(file);
  };

  const onShareEditedStory = async (blob: Blob) => {
    if (!token) return;
    setError(null);
    setUploadBusy(true);
    try {
      const file = new File([blob], "story.jpg", { type: blob.type || "image/jpeg" });
      await chatApi.createStory(token, { file });
      setEditorFile(null);
      await loadFeed();
    } catch (e) {
      setError(readAxiosErrorMessage(e) ?? "Could not post story.");
    } finally {
      setUploadBusy(false);
    }
  };

  const currentStory = viewer ? viewer.stories[viewer.index] ?? null : null;
  const canDeleteCurrent =
    !!currentStory &&
    !!currentUserId &&
    !!currentStory.userId &&
    String(currentStory.userId) === String(currentUserId);

  const onDeleteCurrent = async () => {
    if (!viewer || !currentStory || !token) return;
    if (!canDeleteCurrent) return;
    const ok = window.confirm("Delete this story? This cannot be undone.");
    if (!ok) return;
    const targetId = currentStory.id;
    setDeleteBusy(true);
    setError(null);
    try {
      await chatApi.deleteStory(token, targetId);
      setStories((prev) => prev.filter((s) => s.id !== targetId));
      setViewer((cur) => {
        if (!cur) return null;
        const next = cur.stories.filter((s) => s.id !== targetId);
        if (next.length === 0) return null;
        const newIndex = Math.min(cur.index, next.length - 1);
        return { ...cur, stories: next, index: newIndex };
      });
    } catch (e) {
      setError(readAxiosErrorMessage(e) ?? "Could not delete story.");
    } finally {
      setDeleteBusy(false);
    }
  };

  const viewerAvatarSrc = getImageUrl(viewerAvatarUrl ?? undefined);

  type AddItem = { kind: "add"; id: "__add__"; avatarSrc: string | undefined };
  type FriendItem = {
    kind: "friend";
    id: string;
    mediaSrc: string;
    userAvatarSrc: string | undefined;
    label: string;
    stories: Story[];
  };
  type StoryItem = AddItem | FriendItem;

  const sortAsc = (a: Story, b: Story) => {
    const at = a.createdAt ? Date.parse(a.createdAt) : 0;
    const bt = b.createdAt ? Date.parse(b.createdAt) : 0;
    return at - bt;
  };

  const groupsByUserId = stories.reduce<Record<string, Story[]>>((acc, s) => {
    const uid = s.userId == null ? "" : String(s.userId).trim();
    if (!uid) return acc;
    if (!s.mediaUrl || !s.mediaUrl.trim()) return acc;
    (acc[uid] ??= []).push(s);
    return acc;
  }, {});

  const friendItems: FriendItem[] = Object.entries(groupsByUserId)
    .map<FriendItem | null>(([uid, list]) => {
      const ordered = [...list].sort(sortAsc);
      const newest = ordered[ordered.length - 1];
      const mediaSrc = getImageUrl(newest.mediaUrl ?? undefined);
      if (!mediaSrc) return null;
      const label =
        (newest.displayName ?? "").trim() || (newest.username ?? "").trim() || "Story";
      return {
        kind: "friend",
        id: `user-${uid}`,
        mediaSrc,
        userAvatarSrc: getImageUrl(newest.userAvatarUrl ?? undefined),
        label,
        stories: ordered,
      };
    })
    .filter((x): x is FriendItem => x !== null);

  const items: StoryItem[] = [
    { kind: "add", id: "__add__", avatarSrc: viewerAvatarSrc },
    ...friendItems,
  ];

  const openUserViewer = (item: FriendItem) => {
    setViewer({
      label: item.label,
      avatarSrc: item.userAvatarSrc,
      stories: item.stories,
      index: 0,
    });
  };

  const currentStorySrc = currentStory
    ? getImageUrl(currentStory.mediaUrl ?? undefined)
    : undefined;

  return (
    <>
      <div
        className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="region"
        aria-label="Stories"
      >
        {items.map((item) => {
          if (item.kind === "add") {
            return (
              <button
                key={item.id}
                type="button"
                disabled={uploadBusy}
                className="relative aspect-[2/3] w-[118px] shrink-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1E7F73]/40 disabled:cursor-not-allowed disabled:opacity-70 sm:w-[128px] dark:border-slate-700 dark:bg-slate-800"
                onClick={() => fileInputRef.current?.click()}
                aria-label={uploadBusy ? "Uploading story" : "Add a story"}
              >
                {item.avatarSrc ? (
                  <SafeRemoteImage
                    src={item.avatarSrc}
                    alt=""
                    className="absolute inset-0 h-full w-full object-cover opacity-90"
                    variant="cover"
                  />
                ) : (
                  <div className="absolute inset-0 bg-gradient-to-b from-slate-200 to-slate-100 dark:from-slate-700 dark:to-slate-800" />
                )}
                <div className="absolute inset-x-0 bottom-0 h-[42%] bg-white dark:bg-slate-800" />
                <span
                  className="absolute left-1/2 top-[58%] flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-4 border-white text-white shadow-md dark:border-slate-800"
                  style={{ backgroundColor: TEAL }}
                  aria-hidden
                >
                  {uploadBusy ? (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/80 border-t-transparent" />
                  ) : (
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.75"
                      strokeLinecap="round"
                    >
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  )}
                </span>
                <span className="absolute inset-x-0 bottom-2 px-2 text-center text-[13px] font-semibold text-slate-800 dark:text-slate-100">
                  {uploadBusy ? "Posting…" : "Add Story"}
                </span>
              </button>
            );
          }

          return (
            <StoryCard
              key={item.id}
              mediaSrc={item.mediaSrc}
              userAvatarSrc={item.userAvatarSrc}
              label={item.label}
              count={item.stories.length}
              onClick={() => openUserViewer(item)}
            />
          );
        })}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(e) => {
            onPickFile(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      <StoryEditorModal
        open={editorFile !== null}
        file={editorFile}
        busy={uploadBusy}
        onClose={() => {
          if (!uploadBusy) setEditorFile(null);
        }}
        onShare={onShareEditedStory}
      />

      {error ? (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}

      {viewer && currentStorySrc ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${viewer.label} story`}
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/92"
        >
          <div className="pointer-events-none absolute inset-x-0 top-3 z-30 mx-auto flex w-[min(640px,92vw)] gap-1 px-3">
            {viewer.stories.map((_, i) => (
              <span
                key={i}
                className="relative h-1 flex-1 overflow-hidden rounded-full bg-white/25"
              >
                {i < viewer.index ? (
                  <span className="absolute inset-0 origin-left rounded-full bg-white" />
                ) : i === viewer.index ? (
                  <span
                    key={`${viewer.index}-${viewer.stories[viewer.index].id}`}
                    className="absolute inset-0 origin-left rounded-full bg-white"
                    style={{
                      animation: `story-progress ${AUTO_CLOSE_MS}ms linear forwards`,
                      animationPlayState: deleteBusy ? "paused" : "running",
                    }}
                  />
                ) : null}
              </span>
            ))}
          </div>

          <div className="pointer-events-none absolute inset-x-0 top-8 z-30 mx-auto mt-1.5 flex w-[min(640px,92vw)] items-center gap-2 px-3 text-white">
            <span className="block h-8 w-8 overflow-hidden rounded-full border-2 border-white/80 bg-slate-700">
              {viewer.avatarSrc ? (
                <SafeRemoteImage
                  src={viewer.avatarSrc}
                  alt=""
                  className="h-full w-full object-cover"
                  variant="avatar"
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-xs font-bold">
                  {viewer.label.slice(0, 1).toUpperCase()}
                </span>
              )}
            </span>
            <span className="truncate text-sm font-semibold drop-shadow">{viewer.label}</span>
            {storyRelativeLabel(currentStory?.createdAt) ? (
              <span className="shrink-0 text-xs text-white/70 drop-shadow">
                · {storyRelativeLabel(currentStory?.createdAt)}
              </span>
            ) : null}
            <span className="ml-auto text-xs text-white/70">
              {viewer.index + 1} / {viewer.stories.length}
            </span>
          </div>

          {canDeleteCurrent ? (
            <button
              type="button"
              disabled={deleteBusy}
              onClick={() => void onDeleteCurrent()}
              className="absolute right-16 top-4 z-40 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white ring-1 ring-white/25 backdrop-blur-sm transition hover:bg-red-500/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300 disabled:opacity-50"
              aria-label="Delete this story"
            >
              {deleteBusy ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/80 border-t-transparent" />
              ) : (
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
                  <path d="M10 11v6M14 11v6" />
                  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                </svg>
              )}
            </button>
          ) : null}

          <button
            type="button"
            className="absolute right-4 top-4 z-40 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-2xl leading-none text-white ring-1 ring-white/25 backdrop-blur-sm transition hover:bg-white/25"
            aria-label="Close story"
            onClick={() => setViewer(null)}
          >
            ×
          </button>

          <SafeRemoteImage
            src={currentStorySrc}
            alt=""
            className="max-h-[92vh] max-w-full rounded-2xl object-contain shadow-2xl"
            variant="cover"
            loading="eager"
          />

          <button
            type="button"
            aria-label="Previous story"
            className="absolute inset-y-0 left-0 z-20 w-[35%] cursor-default focus:outline-none"
            onClick={goBack}
          />
          <button
            type="button"
            aria-label="Next story"
            className="absolute inset-y-0 right-0 z-20 w-[65%] cursor-default focus:outline-none"
            onClick={advanceOrClose}
          />
        </div>
      ) : null}
    </>
  );
}

type StoryCardProps = {
  mediaSrc: string;
  userAvatarSrc: string | undefined;
  label: string;
  count: number;
  onClick: () => void;
};

function StoryCard({ mediaSrc, userAvatarSrc, label, count, onClick }: StoryCardProps) {
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");

  useEffect(() => {
    setState("loading");
  }, [mediaSrc]);

  const initial = label.slice(0, 1).toUpperCase() || "?";

  return (
    <button
      type="button"
      className="relative aspect-[2/3] w-[118px] shrink-0 overflow-hidden rounded-2xl shadow-sm transition hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1E7F73]/40 sm:w-[128px]"
      style={{ borderWidth: "2.5px", borderStyle: "solid", borderColor: TEAL }}
      onClick={onClick}
      aria-label={`View ${label}'s ${count > 1 ? `${count} stories` : "story"}`}
    >
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-br from-slate-200 via-slate-100 to-slate-300 dark:from-slate-700 dark:via-slate-800 dark:to-slate-900"
      />

      {state !== "error" ? (
        <img
          src={mediaSrc}
          alt=""
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ${
            state === "ok" ? "opacity-100" : "opacity-0"
          }`}
          onLoad={() => setState("ok")}
          onError={() => setState("error")}
        />
      ) : null}

      {state === "loading" ? (
        <div className="absolute inset-0 flex items-center justify-center" aria-hidden>
          <span className="h-7 w-7 animate-spin rounded-full border-2 border-slate-400/70 border-t-transparent" />
        </div>
      ) : null}

      {state === "error" ? (
        <span
          className="absolute inset-0 flex items-center justify-center text-3xl font-bold text-slate-500 drop-shadow-sm dark:text-slate-300"
          aria-hidden
        >
          {initial}
        </span>
      ) : null}

      <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/10 to-transparent" />

      <CornerAvatar src={userAvatarSrc} initial={initial} />

      {count > 1 ? (
        <span
          className="absolute right-2 top-2 inline-flex h-6 min-w-[24px] items-center justify-center rounded-full px-1.5 text-[11px] font-bold text-white shadow"
          style={{ backgroundColor: TEAL }}
          aria-hidden
        >
          {count}
        </span>
      ) : null}

      <span className="absolute inset-x-0 bottom-2 truncate px-2 text-center text-[13px] font-semibold text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)]">
        {label}
      </span>
    </button>
  );
}

function CornerAvatar({ src, initial }: { src: string | undefined; initial: string }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    setBroken(false);
  }, [src]);
  const showImage = src && !broken;
  return (
    <span className="absolute left-2 top-2 block h-9 w-9 overflow-hidden rounded-full border-[3px] border-white bg-slate-200 shadow">
      {showImage ? (
        <img
          src={src}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setBroken(true)}
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-xs font-bold text-slate-700">
          {initial}
        </span>
      )}
    </span>
  );
}
