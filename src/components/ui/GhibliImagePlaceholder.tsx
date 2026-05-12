/**
 * Soft watercolor-style placeholder when a remote image fails to load.
 * No gradient IDs so multiple instances on a page never clash.
 */
export function GhibliImagePlaceholder({
  className = "",
  variant: _variant = "cover",
}: {
  className?: string;
  variant?: "avatar" | "cover";
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 200 200"
      preserveAspectRatio="xMidYMid slice"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <rect width="200" height="200" fill="#b9dff0" />
      <circle cx="48" cy="58" r="36" fill="#dceef8" opacity="0.92" />
      <circle cx="152" cy="48" r="44" fill="#eef7fc" opacity="0.78" />
      <ellipse cx="100" cy="168" rx="118" ry="52" fill="#7ec699" opacity="0.88" />
      <ellipse cx="100" cy="178" rx="138" ry="42" fill="#59a67c" opacity="0.92" />
      <ellipse cx="72" cy="148" rx="52" ry="18" fill="#8fd4ae" opacity="0.45" />
      <circle cx="158" cy="118" r="5" fill="#3d7a5c" opacity="0.32" />
      <circle cx="172" cy="130" r="3.5" fill="#3d7a5c" opacity="0.28" />
      <circle cx="148" cy="136" r="2.5" fill="#3d7a5c" opacity="0.25" />
    </svg>
  );
}
