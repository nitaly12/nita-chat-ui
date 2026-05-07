"use client";

import { useCallback, useRef, useState } from "react";

const SLIDE_CANCEL_PX = 72;
const MIN_RECORD_MS = 450;

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = ["audio/webm;codecs=opus", "audio/webm"];
  for (const t of candidates) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return undefined;
}

export type VoiceRecorderUIState = "idle" | "requesting" | "recording";

export function useVoiceRecorder() {
  const [uiState, setUiState] = useState<VoiceRecorderUIState>("idle");
  const [elapsedSec, setElapsedSec] = useState(0);
  const [slideToCancel, setSlideToCancel] = useState(false);

  /** Same as uiState but updated synchronously so pointer handlers are never stale. */
  const phaseRef = useRef<VoiceRecorderUIState>("idle");
  const cancelPendingStartRef = useRef(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startTsRef = useRef(0);
  const pointerDownXRef = useRef(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const slideToCancelRef = useRef(false);

  const stopTicks = (): void => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  };

  const cleanupStream = (): void => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const startRecording = useCallback(async (pointerClientX: number) => {
    pointerDownXRef.current = pointerClientX;
    slideToCancelRef.current = false;
    setSlideToCancel(false);
    cancelPendingStartRef.current = false;
    phaseRef.current = "requesting";
    setUiState("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (cancelPendingStartRef.current) {
        cancelPendingStartRef.current = false;
        stream.getTracks().forEach((t) => t.stop());
        phaseRef.current = "idle";
        setUiState("idle");
        setElapsedSec(0);
        return;
      }
      streamRef.current = stream;
      chunksRef.current = [];
      const mime = pickMimeType();
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      mediaRecorderRef.current = mr;
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      startTsRef.current = Date.now();
      setElapsedSec(0);
      mr.start(120);
      phaseRef.current = "recording";
      setUiState("recording");
      tickRef.current = setInterval(() => {
        setElapsedSec(Math.floor((Date.now() - startTsRef.current) / 1000));
      }, 250);
    } catch {
      cancelPendingStartRef.current = false;
      cleanupStream();
      phaseRef.current = "idle";
      setUiState("idle");
      setElapsedSec(0);
    }
  }, []);

  const onPointerMove = useCallback(
    (clientX: number) => {
      if (mediaRecorderRef.current?.state !== "recording") return;
      const dx = pointerDownXRef.current - clientX;
      const cancel = dx > SLIDE_CANCEL_PX;
      slideToCancelRef.current = cancel;
      setSlideToCancel(cancel);
    },
    []
  );

  const abortRecording = useCallback(() => {
    stopTicks();
    const mr = mediaRecorderRef.current;
    mediaRecorderRef.current = null;
    chunksRef.current = [];
    if (mr && mr.state === "recording") {
      try {
        mr.stop();
      } catch {
        /* ignore */
      }
    }
    cleanupStream();
    phaseRef.current = "idle";
    setUiState("idle");
    setElapsedSec(0);
    slideToCancelRef.current = false;
    setSlideToCancel(false);
  }, []);

  /** Pointer released while still waiting for mic — cancel before recorder starts. */
  const cancelPendingStart = useCallback(() => {
    cancelPendingStartRef.current = true;
  }, []);

  /**
   * Stop recording. If `slideCancelled`, discards audio.
   * Otherwise returns a WebM `Blob` and duration (seconds), or `null` if too short / empty.
   */
  const stopRecording = useCallback(
    (slideCancelled: boolean): Promise<{ blob: Blob; durationSec: number } | null> => {
      return new Promise((resolve) => {
        stopTicks();
        const mr = mediaRecorderRef.current;
        const started = startTsRef.current;
        if (!mr) {
          cleanupStream();
          phaseRef.current = "idle";
          setUiState("idle");
          setElapsedSec(0);
          slideToCancelRef.current = false;
          setSlideToCancel(false);
          resolve(null);
          return;
        }

        const done = (): void => {
          mediaRecorderRef.current = null;
          cleanupStream();
          phaseRef.current = "idle";
          setUiState("idle");
          setElapsedSec(0);
          slideToCancelRef.current = false;
          setSlideToCancel(false);
        };

        mr.onstop = () => {
          if (slideCancelled) {
            chunksRef.current = [];
            done();
            resolve(null);
            return;
          }
          const mime = mr.mimeType || "audio/webm";
          const blob = new Blob(chunksRef.current, { type: mime });
          chunksRef.current = [];
          const ms = Date.now() - started;
          done();
          if (ms < MIN_RECORD_MS || blob.size < 120) {
            resolve(null);
            return;
          }
          const durationSec = Math.max(1, Math.round(ms / 1000));
          resolve({ blob, durationSec });
        };

        try {
          if (mr.state === "recording") mr.stop();
          else {
            done();
            resolve(null);
          }
        } catch {
          done();
          resolve(null);
        }
      });
    },
    []
  );

  const getSlideToCancel = useCallback(() => slideToCancelRef.current, []);

  const getPhase = useCallback(() => phaseRef.current, []);

  return {
    uiState,
    elapsedSec,
    slideToCancel,
    getPhase,
    getSlideToCancel,
    cancelPendingStart,
    startRecording,
    onPointerMove,
    stopRecording,
    abortRecording,
  };
}
