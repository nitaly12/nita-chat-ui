"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { chatApi } from "@/chat/api";

export type FriendshipUiContextValue = {
  /** User ids excluded from “Suggested connections” (server friendships + optimistic sends). */
  hiddenSuggestionUserIds: ReadonlySet<string>;
  hideUserFromSuggestions: (userId: string) => void;
  /** Undo optimistic hide when add-friend fails (non-409). */
  unhideUserFromSuggestions: (userId: string) => void;
  /** Re-fetch chats/users/feed after any social action (sidebar + discovery). */
  refreshAfterSocialChange: () => Promise<void>;
  /** After confirming or declining an incoming request — refreshes chats (sidebar) and feed. */
  onIncomingFriendResolved: (userId: string, accepted: boolean) => Promise<void>;
  /** Hide + refresh (e.g. legacy single call). */
  afterOutgoingFriendRequest: (userId: string) => Promise<void>;
};

const FriendshipUiContext = createContext<FriendshipUiContextValue | null>(null);

type FriendshipUiProviderProps = {
  children: ReactNode;
  /** Access token for `GET /api/friendships` sync after refresh. */
  token: string;
  onRefreshChatsAndUsers: () => Promise<void>;
  startPrivateChat: (peerUserId: string) => Promise<unknown>;
};

export function FriendshipUiProvider({
  children,
  token,
  onRefreshChatsAndUsers,
  startPrivateChat,
}: FriendshipUiProviderProps) {
  const [hiddenSuggestionUserIds, setHiddenSuggestionUserIds] = useState(() => new Set<string>());

  const hideUserFromSuggestions = useCallback((userId: string) => {
    const id = userId.trim();
    if (!id) return;
    setHiddenSuggestionUserIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const unhideUserFromSuggestions = useCallback((userId: string) => {
    const id = userId.trim();
    if (!id) return;
    setHiddenSuggestionUserIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const applyPeersFromFriendships = useCallback(async () => {
    const t = token.trim();
    if (!t) return;
    try {
      const ids = await chatApi.listFriendshipPeerUserIds(t);
      for (const id of ids) hideUserFromSuggestions(id);
    } catch {
      /* optional */
    }
  }, [token, hideUserFromSuggestions]);

  const refreshAfterSocialChange = useCallback(async () => {
    await onRefreshChatsAndUsers();
    await applyPeersFromFriendships();
  }, [onRefreshChatsAndUsers, applyPeersFromFriendships]);

  useEffect(() => {
    if (!token.trim()) {
      setHiddenSuggestionUserIds(new Set());
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const ids = await chatApi.listFriendshipPeerUserIds(token);
        if (cancelled) return;
        for (const id of ids) hideUserFromSuggestions(id);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, hideUserFromSuggestions]);

  const onIncomingFriendResolved = useCallback(
    async (userId: string, accepted: boolean) => {
      if (accepted) {
        hideUserFromSuggestions(userId);
        try {
          await startPrivateChat(userId);
        } catch {
          /* still refresh */
        }
      }
      await refreshAfterSocialChange();
    },
    [hideUserFromSuggestions, refreshAfterSocialChange, startPrivateChat]
  );

  const afterOutgoingFriendRequest = useCallback(
    async (userId: string) => {
      hideUserFromSuggestions(userId);
      await refreshAfterSocialChange();
    },
    [hideUserFromSuggestions, refreshAfterSocialChange]
  );

  const value = useMemo<FriendshipUiContextValue>(
    () => ({
      hiddenSuggestionUserIds,
      hideUserFromSuggestions,
      unhideUserFromSuggestions,
      refreshAfterSocialChange,
      onIncomingFriendResolved,
      afterOutgoingFriendRequest,
    }),
    [
      hiddenSuggestionUserIds,
      hideUserFromSuggestions,
      unhideUserFromSuggestions,
      refreshAfterSocialChange,
      onIncomingFriendResolved,
      afterOutgoingFriendRequest,
    ]
  );

  return <FriendshipUiContext.Provider value={value}>{children}</FriendshipUiContext.Provider>;
}

export function useFriendshipUi(): FriendshipUiContextValue {
  const v = useContext(FriendshipUiContext);
  if (!v) {
    throw new Error("useFriendshipUi must be used within FriendshipUiProvider");
  }
  return v;
}

export function useFriendshipUiOptional(): FriendshipUiContextValue | null {
  return useContext(FriendshipUiContext);
}
