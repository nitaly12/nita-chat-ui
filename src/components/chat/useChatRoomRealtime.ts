"use client";

import { Client, IMessage } from "@stomp/stompjs";
import { useCallback, useEffect, useRef, useState } from "react";
import SockJS from "sockjs-client";
import { normalizeMessageBody } from "../../chat/api";
import type { ChatMessage } from "../../chat/types";

type TypingPayload = {
  username?: string;
  user?: string;
  sender?: string;
  typing?: boolean;
};

const WS_BASE = (
  process.env.NEXT_PUBLIC_SOCKET_URL?.trim() || "http://localhost:8080"
).replace(/\/+$/, "");
const WS_URL = `${WS_BASE}/ws-chat`;

type Handlers = {
  onRoomMessage?: (message: ChatMessage) => void;
  /** Full STOMP payload — may include `reactionSummary`, `count`, etc. */
  onRoomReactionEvent?: (event: Record<string, unknown>) => void;
  onTypingUsers?: (usernames: string[]) => void;
};

export function useChatRoomRealtime(
  token: string | null,
  roomId: string | null,
  currentUsername: string | null,
  handlers: Handlers
): {
  sendTypingPing: () => void;
  sendMessagePayload: (content: string, parentMessageId?: string) => void;
  typingUsers: string[];
} {
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const typingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const clientRef = useRef<Client | null>(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const clearTypingUser = useCallback((username: string) => {
    const t = typingTimers.current.get(username);
    if (t) clearTimeout(t);
    typingTimers.current.delete(username);
    setTypingUsers((prev) => {
      const next = prev.filter((u) => u !== username);
      handlersRef.current.onTypingUsers?.(next);
      return next;
    });
  }, []);

  const markTyping = useCallback(
    (username: string) => {
      if (!username || username === currentUsername) return;
      setTypingUsers((prev) => {
        if (prev.includes(username)) return prev;
        const next = [...prev, username];
        handlersRef.current.onTypingUsers?.(next);
        return next;
      });
      const existing = typingTimers.current.get(username);
      if (existing) clearTimeout(existing);
      const t = setTimeout(() => clearTypingUser(username), 3200);
      typingTimers.current.set(username, t);
    },
    [clearTypingUser, currentUsername]
  );

  useEffect(() => {
    if (!token || !roomId) {
      typingTimers.current.forEach(clearTimeout);
      typingTimers.current.clear();
      setTypingUsers([]);
      handlersRef.current.onTypingUsers?.([]);
      return;
    }

    const client = new Client({
      webSocketFactory: () => new SockJS(WS_URL),
      connectHeaders: {
        Authorization: `Bearer ${token}`,
      },
      reconnectDelay: 5000,
      onConnect: () => {
        client.subscribe(`/topic/room/${roomId}/typing`, (frame: IMessage) => {
          try {
            const body = JSON.parse(frame.body) as TypingPayload;
            const u = String(body.username ?? body.user ?? body.sender ?? "").trim();
            if (!u) return;
            const typing = body.typing !== false;
            if (typing) markTyping(u);
            else clearTypingUser(u);
          } catch {
            /* ignore */
          }
        });

        client.subscribe(`/topic/room/${roomId}`, (frame: IMessage) => {
          try {
            const raw = JSON.parse(frame.body) as unknown;
            if (raw && typeof raw === "object") {
              const r0 = raw as Record<string, unknown>;
              const nested =
                (r0.payload && typeof r0.payload === "object" && !Array.isArray(r0.payload)
                  ? (r0.payload as Record<string, unknown>)
                  : null) ??
                (r0.body && typeof r0.body === "object" && !Array.isArray(r0.body)
                  ? (r0.body as Record<string, unknown>)
                  : null) ??
                (r0.data && typeof r0.data === "object" && !Array.isArray(r0.data)
                  ? (r0.data as Record<string, unknown>)
                  : null);
              const r = nested ? { ...r0, ...nested } : r0;
              const looksLikeReactionEvent =
                (typeof r.messageId !== "undefined" || typeof r.message_id !== "undefined") &&
                (typeof r.action === "string" ||
                  typeof r.emoji === "string" ||
                  "reactionSummary" in r ||
                  "reaction_summary" in r ||
                  (r.reactions != null && typeof r.reactions === "object"));
              if (looksLikeReactionEvent) {
                handlersRef.current.onRoomReactionEvent?.(r);
                return;
              }
            }
            const msg = normalizeMessageBody(raw);
            handlersRef.current.onRoomMessage?.({ ...msg, roomId: msg.roomId || roomId });
          } catch {
            /* ignore */
          }
        });
      },
    });

    client.activate();
    clientRef.current = client;

    return () => {
      typingTimers.current.forEach(clearTimeout);
      typingTimers.current.clear();
      setTypingUsers([]);
      handlersRef.current.onTypingUsers?.([]);
      void client.deactivate();
      clientRef.current = null;
    };
  }, [token, roomId, markTyping, clearTypingUser]);

  const sendTypingPing = useCallback(() => {
    const client = clientRef.current;
    if (!client?.connected || !roomId || !currentUsername) return;
    client.publish({
      destination: `/app/chat.typing/${roomId}`,
      body: JSON.stringify({ username: currentUsername, typing: true }),
    });
  }, [roomId, currentUsername]);

  const sendMessagePayload = useCallback(
    (content: string, parentMessageId?: string) => {
      const client = clientRef.current;
      if (!client?.connected || !roomId) return;
      client.publish({
        destination: `/app/chat.send/${roomId}`,
        body: JSON.stringify({
          roomId,
          content,
          message: content,
          parentMessageId: parentMessageId?.trim() || undefined,
        }),
      });
    },
    [roomId]
  );

  return { sendTypingPing, sendMessagePayload, typingUsers };
}
