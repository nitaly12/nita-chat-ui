/**
 * Opt-in diagnostics for voice + message mapping.
 *
 * Enable either:
 * - `.env.local`: `NEXT_PUBLIC_CHAT_DEBUG=1` (restart `next dev`)
 * - Browser console: `localStorage.setItem('chatDebug','1')` then reload
 * Disable: `localStorage.removeItem('chatDebug')` or unset the env var.
 */

export function isChatDebug(): boolean {
  if (process.env.NEXT_PUBLIC_CHAT_DEBUG === "1") return true;
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem("chatDebug") === "1";
  } catch {
    return false;
  }
}

export function chatDebug(label: string, data?: unknown): void {
  if (!isChatDebug()) return;
  /** Use `log` so lines show with default DevTools levels (`debug` is often hidden). */
  if (data !== undefined) console.log(`[chat] ${label}`, data);
  else console.log(`[chat] ${label}`);
}

let announced = false;

/** Call once after mount so you see confirmation without waiting for a message. */
export function announceChatDebugOnce(): void {
  if (!isChatDebug() || announced) return;
  announced = true;
  console.log(
    "[chat] Debug ON — you will see mapMessage + voice/audio lines here. Turn off: localStorage.removeItem('chatDebug')"
  );
}
