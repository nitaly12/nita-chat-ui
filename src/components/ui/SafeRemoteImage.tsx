"use client";

import { useCallback, useEffect, useState } from "react";
import { getImageUrl } from "@/utils/getImageUrl";
import { GhibliImagePlaceholder } from "./GhibliImagePlaceholder";

export type SafeRemoteImageProps = {
  src: string | null | undefined;
  alt?: string;
  className?: string;
  variant?: "avatar" | "cover";
  loading?: "eager" | "lazy";
  decoding?: "async" | "auto" | "sync";
};

/**
 * Remote image with `getImageUrl` resolution and a Ghibli-style SVG fallback on error.
 */
export function SafeRemoteImage({
  src,
  alt = "",
  className = "",
  variant = "cover",
  loading = "lazy",
  decoding = "async",
}: SafeRemoteImageProps) {
  const [broken, setBroken] = useState(false);
  const resolved = getImageUrl(src);

  useEffect(() => {
    setBroken(false);
  }, [src]);

  const onError = useCallback(() => {
    setBroken(true);
  }, []);

  if (!resolved || broken) {
    return <GhibliImagePlaceholder variant={variant} className={className} />;
  }

  return (
    <img
      src={resolved}
      alt={alt}
      className={className}
      loading={loading}
      decoding={decoding}
      onError={onError}
    />
  );
}
