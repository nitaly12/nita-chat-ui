const TZ_SUFFIX = /([zZ]|[+-]\d{2}:?\d{2})$/;

/**
 * Spring often returns `LocalDateTime` / JDBC timestamps as ISO strings **without** `Z` or offset.
 * ECMAScript then parses them as **local** time, which skews "ago" labels vs real UTC instants.
 * If there is no zone suffix, treat the value as UTC by appending `Z`.
 */
export function normalizeBackendTimestamp(raw: string | undefined | null): string | undefined {
  if (raw == null) return undefined;
  const s = String(raw).trim();
  if (!s) return undefined;
  return TZ_SUFFIX.test(s) ? s : `${s}Z`;
}
