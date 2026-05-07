"use client";

import { io, type Socket } from "socket.io-client";

/** Default Socket.IO event name; change if your server listens on another channel. */
export const VOICE_SOCKET_EVENT = "message";

export type VoiceSocketPayload = {
  type: "voice";
  audioUrl: string;
  roomId: string;
  durationSec: number;
};

/**
 * Emit `{ type: "voice", audioUrl, roomId, durationSec }` over Socket.IO after upload.
 * Set `NEXT_PUBLIC_SOCKET_URL` (e.g. `http://localhost:3001`) to enable; otherwise no-op.
 * The connection is short-lived: connect → emit → disconnect.
 */
export function emitVoiceMessageSocket(payload: VoiceSocketPayload): void {
  const url = process.env.NEXT_PUBLIC_SOCKET_URL?.trim();
  if (!url || typeof window === "undefined") return;

  const socket: Socket = io(url, { transports: ["websocket"] });
  const body = {
    type: "voice" as const,
    audioUrl: payload.audioUrl,
    roomId: payload.roomId,
    durationSec: payload.durationSec,
  };
  const send = (): void => {
    socket.emit(VOICE_SOCKET_EVENT, body);
    socket.disconnect();
  };
  socket.once("connect_error", () => {
    socket.disconnect();
  });
  queueMicrotask(() => {
    if (socket.connected) send();
    else socket.once("connect", send);
  });
}
