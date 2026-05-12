"use client";

import { useId } from "react";

type WatercolorBackdropProps = { className?: string };

/** Decorative header / placeholder art (inline SVG, unique gradient ids per instance). */
export function WatercolorBackdrop({ className }: WatercolorBackdropProps) {
  const gid = useId().replace(/:/g, "");
  const gradId = `watercolorGrad-${gid}`;
  return (
    <svg
      className={className}
      preserveAspectRatio="xMidYMid slice"
      viewBox="0 0 900 160"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <defs>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#bfe8df" />
          <stop offset="45%" stopColor="#d4ead8" />
          <stop offset="100%" stopColor="#c5dff0" />
        </linearGradient>
      </defs>
      <rect width="900" height="160" fill={`url(#${gradId})`} />
      <ellipse cx="120" cy="140" rx="220" ry="90" fill="#6fa89a" opacity="0.22" />
      <ellipse cx="700" cy="30" rx="260" ry="120" fill="#5a8ab8" opacity="0.18" />
      <ellipse cx="460" cy="90" rx="160" ry="70" fill="#8bc4a8" opacity="0.14" />
    </svg>
  );
}
