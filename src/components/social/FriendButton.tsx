"use client";

import axios from "axios";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { chatApi, parseJwtIdentity, readAxiosErrorMessage } from "@/chat/api";
import { useFriendshipUiOptional } from "@/contexts/FriendshipUiContext";
import type { FriendshipSnapshot, FriendshipUiStatus } from "@/chat/types";

export type FriendButtonProps = {
  token: string;
  targetUserId: string;
  className?: string;
  /** Tighter padding for sidebar rows. */
  compact?: boolean;
  /** Full-width stacked actions for suggestion cards (Friends tab grid). */
  layout?: "inline" | "card";
  /**
   * Suggested-connections UI: outgoing pending shows non-actionable "Requested.";
   * accepted shows a checkmark. Profile / full controls use default (e.g. Cancel Request).
   */
  suggestionList?: boolean;
  /** Fired whenever friendship snapshot changes (load, add, cancel, accept, decline). */
  onSnapshotChange?: (userId: string, snapshot: FriendshipSnapshot) => void;
  /**
   * Optional fallback when `suggestionList` is used outside `FriendshipUiProvider`
   * (normally `FriendshipUiContext` handles hide + sidebar refresh).
   */
  onSuggestionDismissed?: (userId: string) => void;
};

export default function FriendButton({
  token,
  targetUserId,
  className = "",
  compact,
  layout = "inline",
  suggestionList,
  onSnapshotChange,
  onSuggestionDismissed,
}: FriendButtonProps) {
  const friendshipUi = useFriendshipUiOptional();
  const [snapshot, setSnapshot] = useState<FriendshipSnapshot>({ status: null });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSnapshotChangeRef = useRef(onSnapshotChange);
  onSnapshotChangeRef.current = onSnapshotChange;
  const onSuggestionDismissedRef = useRef(onSuggestionDismissed);
  onSuggestionDismissedRef.current = onSuggestionDismissed;

  const applySnapshot = useCallback(
    (next: FriendshipSnapshot) => {
      setSnapshot(next);
      const id = targetUserId.trim();
      if (id) onSnapshotChangeRef.current?.(id, next);
    },
    [targetUserId]
  );

  const meId = useMemo(() => {
    const j = parseJwtIdentity(token);
    return j.userId?.trim() || null;
  }, [token]);

  const isSelf = Boolean(meId && String(targetUserId).trim() === String(meId));

  const refresh = useCallback(async () => {
    if (!token.trim() || !targetUserId.trim() || isSelf) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const s = await chatApi.getFriendshipStatus(token, targetUserId.trim());
      applySnapshot(s);
    } catch (e) {
      if (axios.isAxiosError(e) && (e.response?.status === 401 || e.response?.status === 403)) {
        applySnapshot({ status: null });
      } else {
        setError(readAxiosErrorMessage(e) ?? "Could not load friend status.");
      }
    } finally {
      setLoading(false);
    }
  }, [token, targetUserId, isSelf, applySnapshot]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const clearErrorSoon = useCallback(() => {
    window.setTimeout(() => setError(null), 4000);
  }, []);

  const handleAddFriend = async () => {
    if (!token.trim() || busy) return;
    const uid = targetUserId.trim();
    setBusy(true);
    setError(null);
    let optimisticHidden = false;
    if (suggestionList && friendshipUi) {
      friendshipUi.hideUserFromSuggestions(uid);
      optimisticHidden = true;
    }
    if (suggestionList) {
      applySnapshot({ status: "PENDING" });
    }
    try {
      if (suggestionList) {
        await chatApi.sendFriendRequest(token, uid);
        if (friendshipUi) {
          await friendshipUi.refreshAfterSocialChange();
        } else {
          onSuggestionDismissedRef.current?.(uid);
        }
      } else {
        const next = await chatApi.sendFriendRequest(token, uid);
        applySnapshot(next.status != null ? next : { status: "PENDING", requestId: next.requestId });
      }
    } catch (e) {
      const is409 = axios.isAxiosError(e) && e.response?.status === 409;
      if (is409) {
        if (suggestionList) {
          if (friendshipUi) {
            await friendshipUi.refreshAfterSocialChange();
          } else {
            onSuggestionDismissedRef.current?.(uid);
          }
        } else {
          try {
            const s = await chatApi.getFriendshipStatus(token, uid);
            applySnapshot(s);
          } catch {
            applySnapshot({ status: "PENDING" });
          }
        }
        setError(null);
      } else {
        if (suggestionList && optimisticHidden && friendshipUi) {
          friendshipUi.unhideUserFromSuggestions(uid);
        }
        if (suggestionList) {
          applySnapshot({ status: null });
        }
        setError(readAxiosErrorMessage(e) ?? "Could not send request.");
        clearErrorSoon();
      }
    } finally {
      setBusy(false);
    }
  };

  const onCancel = async () => {
    if (!token.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await chatApi.cancelFriendRequest(
        token,
        snapshot.requestId?.trim() ?? "",
        targetUserId.trim()
      );
      applySnapshot({ status: null });
      await friendshipUi?.refreshAfterSocialChange();
    } catch (e) {
      setError(readAxiosErrorMessage(e) ?? "Could not cancel request.");
      clearErrorSoon();
    } finally {
      setBusy(false);
    }
  };

  const onAccept = async () => {
    if (!token.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const rid = snapshot.requestId?.trim() ?? "";
      const next = await chatApi.acceptFriendRequest(token, rid, targetUserId.trim());
      applySnapshot(next.status != null ? next : { status: "ACCEPTED" });
      await friendshipUi?.refreshAfterSocialChange();
    } catch (e) {
      setError(readAxiosErrorMessage(e) ?? "Could not confirm.");
      clearErrorSoon();
    } finally {
      setBusy(false);
    }
  };

  const onDecline = async () => {
    if (!token.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await chatApi.declineFriendRequest(
        token,
        snapshot.requestId?.trim() ?? "",
        targetUserId.trim()
      );
      applySnapshot({ status: null });
      await friendshipUi?.refreshAfterSocialChange();
    } catch (e) {
      setError(readAxiosErrorMessage(e) ?? "Could not delete request.");
      clearErrorSoon();
    } finally {
      setBusy(false);
    }
  };

  if (!token.trim() || !targetUserId.trim() || isSelf) {
    return null;
  }

  const isCard = layout === "card";
  const pad = isCard ? "px-4 py-2.5 text-sm" : compact ? "px-2 py-2 text-[11px]" : "px-3 py-1.5 text-xs";
  const status: FriendshipUiStatus = snapshot.status;

  const rootClass =
    isCard
      ? `flex w-full flex-col items-stretch gap-1.5 ${className}`
      : `flex flex-col items-end gap-0.5 ${className}`;

  if (loading) {
    return (
      <span
        className={`inline-flex shrink-0 rounded-xl border border-slate-200/80 bg-slate-50 text-slate-500 dark:border-slate-600 dark:bg-slate-800 ${pad} ${isCard ? "w-full justify-center" : ""} ${className}`}
      >
        …
      </span>
    );
  }

  const addBtnClass = isCard
    ? "flex w-full items-center justify-center rounded-xl bg-[#2563EB] font-semibold text-white shadow-sm transition hover:bg-[#1d4ed8] disabled:opacity-50"
    : `inline-flex shrink-0 rounded-xl bg-[#2563EB] font-semibold text-white hover:bg-[#1d4ed8] disabled:opacity-50 ${pad}`;

  return (
    <div className={rootClass}>
      {status === null ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void handleAddFriend()}
          className={isCard ? `${addBtnClass} py-2.5 text-sm` : addBtnClass}
        >
          {busy && !suggestionList ? "…" : "Add Friend"}
        </button>
      ) : null}

      {status === "PENDING" ? (
        suggestionList ? (
          <span
            className={`font-medium text-slate-500 dark:text-slate-400 ${isCard ? "flex w-full items-center justify-center rounded-xl border border-slate-200 bg-slate-50 py-2.5 text-sm dark:border-slate-600 dark:bg-slate-800" : `inline-flex shrink-0 rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-600 dark:bg-slate-800 ${pad}`}`}
            aria-live="polite"
          >
            {busy ? "…" : "Pending"}
          </span>
        ) : (
          <div className={`flex flex-col gap-1 ${isCard ? "items-stretch" : "items-end"}`}>
            <span
              className={`inline-flex shrink-0 rounded-lg border border-slate-200 bg-slate-50 font-medium text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 ${pad}`}
            >
              Pending
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => void onCancel()}
              className={`inline-flex shrink-0 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 ${compact ? "px-2 py-0.5" : "px-2 py-1"}`}
            >
              {busy ? "…" : "Cancel"}
            </button>
          </div>
        )
      ) : null}

      {status === "RECEIVED" ? (
        <div
          className={
            isCard
              ? "flex w-full gap-2"
              : "flex flex-wrap items-center justify-end gap-1"
          }
        >
          <button
            type="button"
            disabled={busy}
            onClick={() => void onAccept()}
            className={
              isCard
                ? "flex min-h-[42px] flex-1 items-center justify-center rounded-xl bg-[#1E7F73] text-sm font-semibold text-white shadow-sm transition hover:bg-[#196a60] disabled:opacity-50"
                : `inline-flex shrink-0 rounded-lg bg-[#1E7F73] font-semibold text-white hover:bg-[#196a60] disabled:opacity-50 ${pad}`
            }
          >
            {busy ? "…" : "Accept"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void onDecline()}
            className={
              isCard
                ? "flex min-h-[42px] flex-1 items-center justify-center rounded-xl bg-[#E5E7EB] text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-[#d1d5db] disabled:opacity-50 dark:bg-slate-600 dark:text-slate-100 dark:hover:bg-slate-500"
                : `inline-flex shrink-0 rounded-xl border border-slate-300 bg-[#E5E7EB] font-semibold text-slate-700 hover:bg-[#d1d5db] disabled:opacity-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600 ${pad}`
            }
          >
            {busy ? "…" : "Ignore"}
          </button>
        </div>
      ) : null}

      {status === "ACCEPTED" ? (
        suggestionList ? (
          <span
            className={`items-center gap-1 font-semibold text-emerald-800 dark:text-emerald-200 ${isCard ? "flex w-full justify-center rounded-xl border border-emerald-200 bg-emerald-50 py-2.5 text-sm dark:border-emerald-800/60 dark:bg-emerald-950/40" : `inline-flex shrink-0 rounded-lg border border-emerald-200 bg-emerald-50 dark:border-emerald-800/60 dark:bg-emerald-950/40 ${pad}`}`}
            title="Friends"
          >
            <span aria-hidden>✓</span>
            <span className="sr-only">Friends</span>
          </span>
        ) : (
          <span
            className={`inline-flex shrink-0 rounded-lg border border-slate-300 bg-transparent font-semibold text-slate-700 dark:border-slate-500 dark:text-slate-200 ${pad}`}
          >
            Friends
          </span>
        )
      ) : null}

      {error ? (
        <p
          className={`text-[10px] text-red-600 dark:text-red-400 ${isCard ? "text-center" : "max-w-[140px] text-right"}`}
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
