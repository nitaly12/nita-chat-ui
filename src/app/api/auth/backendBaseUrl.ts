/**
 * Spring origin for Next.js Route Handlers under `app/api/auth/*`.
 * Keep in sync with `next.config.ts` rewrites (`/backend/:path*` destination).
 */
export function resolveAuthBackendBaseUrl(): string {
  return (
    process.env.BACKEND_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_API_BASE?.trim() ||
    process.env.NEXT_PUBLIC_SOCKET_URL?.trim() ||
    "http://localhost:8080"
  ).replace(/\/+$/, "");
}
