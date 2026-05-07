"use client";

import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";

/**
 * Socket.IO read receipts: emit `mark-as-seen` on connect, listen for `messages-seen`.
 *
 * Only runs when `NEXT_PUBLIC_SOCKET_URL` is set. The Spring app on :8080 uses STOMP/SockJS
 * (`/ws-chat`), not the Socket.IO protocol — pointing this at the REST origin causes
 * `ws://…/socket.io/` failures and endless retries.
 */
export function useChatSeenReceipt(
  token: string | null,
  conversationId: string | null,
  userId: string | null,
  onMessagesSeen: (payload: unknown) => void
): void {
  const onSeenRef = useRef(onMessagesSeen);
  onSeenRef.current = onMessagesSeen;

  useEffect(() => {
    if (!token || !conversationId || !userId) return;

    const url = process.env.NEXT_PUBLIC_SOCKET_URL?.trim();
    if (!url) return;

    const socket: Socket = io(url, {
      transports: ["websocket", "polling"],
      auth: { token },
      reconnectionAttempts: 5,
      reconnectionDelay: 2000,
    });

    const emitMark = (): void => {
      socket.emit("mark-as-seen", { conversationId, userId });
    };

    const onSeen = (payload: unknown): void => {
      onSeenRef.current(payload);
    };

    socket.on("connect", emitMark);
    socket.on("messages-seen", onSeen);
    if (socket.connected) emitMark();

    return () => {
      socket.off("connect", emitMark);
      socket.off("messages-seen", onSeen);
      socket.disconnect();
    };
  }, [token, conversationId, userId]);
}
