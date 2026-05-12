import { toPublicBackendUrl } from "@/chat/api";

/**
 * Resolves image paths for `<img src>` (avatars, covers, uploads).
 * - Absolute `http(s)://` URLs are returned unchanged (local / CDN compatibility).
 * - `blob:` and `data:` URLs are unchanged.
 * - Relative paths (e.g. `/uploads/...`) are prefixed with `process.env.REACT_APP_API_URL`
 *   when set (injected from `NEXT_PUBLIC_API_URL` / `NEXT_PUBLIC_API_BASE` in `next.config.ts`).
 * - Otherwise falls back to `toPublicBackendUrl` (same-origin `/backend` proxy in production).
 */
export function getImageUrl(path: string | null | undefined): string | undefined {
  if (path == null) return undefined;
  const p = String(path).trim();
  if (!p) return undefined;
  if (/^https?:\/\//i.test(p)) return p;
  if (p.startsWith("blob:") || p.startsWith("data:")) return p;
  if (p.startsWith("//")) return `https:${p}`;

  const base = (
    typeof process !== "undefined" ? process.env.REACT_APP_API_URL?.trim() || "" : ""
  ).replace(/\/+$/, "");
  if (base) {
    const part = p.startsWith("/") ? p : `/${p}`;
    return `${base}${part}`;
  }

  return toPublicBackendUrl(p);
}
