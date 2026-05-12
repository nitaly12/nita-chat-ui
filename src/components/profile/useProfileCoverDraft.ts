"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

export type ProfileCoverDraft = {
  selectedFile: File | null;
  /** True when user requested removal of the server cover (applied on save). */
  removalPending: boolean;
  /** Blob URL for {@link selectedFile}; revoked automatically. */
  objectPreviewUrl: string | null;
  /** Clears pending file + removal flag (e.g. after load or modal close). */
  reset: () => void;
  /** Pick / replace local cover file (clears removal pending). */
  pickFile: (file: File) => void;
  /** Discard local file, mark server cover for removal, or undo removal. */
  secondaryAction: (serverHasCover: boolean) => void;
  /** URL to show in preview: local blob first, else server URL when not marked removed. */
  effectivePreviewUrl: (serverCoverUrl: string | null) => string | null;
  /** Whether secondary button should be enabled. */
  canUseSecondary: (serverCoverUrl: string | null) => boolean;
  secondaryLabel: () => string;
};

/**
 * Local cover selection + “remove after save” state, with safe `createObjectURL` / revoke.
 */
export function useProfileCoverDraft(): ProfileCoverDraft {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [removalPending, setRemovalPending] = useState(false);
  const [objectPreviewUrl, setObjectPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedFile) {
      setObjectPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(selectedFile);
    setObjectPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [selectedFile]);

  const reset = useCallback(() => {
    setSelectedFile(null);
    setRemovalPending(false);
  }, []);

  const pickFile = useCallback((file: File) => {
    setRemovalPending(false);
    setSelectedFile(file);
  }, []);

  const secondaryAction = useCallback((serverHasCover: boolean) => {
    if (selectedFile) {
      setSelectedFile(null);
      return;
    }
    if (removalPending) {
      setRemovalPending(false);
      return;
    }
    if (serverHasCover) setRemovalPending(true);
  }, [selectedFile, removalPending]);

  const effectivePreviewUrl = useCallback(
    (serverCoverUrl: string | null) => {
      if (objectPreviewUrl) return objectPreviewUrl;
      if (serverCoverUrl && !removalPending) return serverCoverUrl;
      return null;
    },
    [objectPreviewUrl, removalPending]
  );

  const canUseSecondary = useCallback(
    (serverCoverUrl: string | null) =>
      Boolean(selectedFile) || Boolean(serverCoverUrl) || removalPending,
    [selectedFile, removalPending]
  );

  const secondaryLabel = useCallback(() => {
    if (selectedFile) return "Discard selected photo";
    if (removalPending) return "Undo remove";
    return "Remove cover photo";
  }, [selectedFile, removalPending]);

  return useMemo(
    () => ({
      selectedFile,
      removalPending,
      objectPreviewUrl,
      reset,
      pickFile,
      secondaryAction,
      effectivePreviewUrl,
      canUseSecondary,
      secondaryLabel,
    }),
    [
      selectedFile,
      removalPending,
      objectPreviewUrl,
      reset,
      pickFile,
      secondaryAction,
      effectivePreviewUrl,
      canUseSecondary,
      secondaryLabel,
    ]
  );
}
