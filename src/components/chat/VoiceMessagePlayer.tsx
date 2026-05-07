"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CHAT_BACKEND_ORIGIN } from "../../chat/api";
import { chatDebug } from "../../chat/chatDebug";

function formatDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}:${r.toString().padStart(2, "0")}` : `0:${r.toString().padStart(2, "0")}`;
}

/** Any absolute URL on the chat API host (voice files may live under `/uploads/`, `/api/...`, etc.). */
function isBackendOriginAbsoluteUrl(src: string): boolean {
  try {
    const u = new URL(src, typeof window !== "undefined" ? window.location.href : "http://localhost:3000");
    if (!/^https?:$/i.test(u.protocol)) return false;
    const b = new URL(CHAT_BACKEND_ORIGIN);
    return u.origin === b.origin;
  } catch {
    return false;
  }
}

function needsBytesNormalize(src: string): boolean {
  if (typeof window === "undefined") return false;
  if (src.startsWith("blob:")) return true;
  return isBackendOriginAbsoluteUrl(src);
}

function sniffAudioMimeFromUrl(url: string, contentTypeHeader: string | null): string {
  const path = url.split("?")[0].toLowerCase();
  if (path.endsWith(".webm")) return "video/webm";
  if (path.endsWith(".mp3")) return "audio/mpeg";
  if (path.endsWith(".wav")) return "audio/wav";
  if (path.endsWith(".ogg") || path.endsWith(".opus")) return "audio/ogg";
  const h = (contentTypeHeader ?? "").split(";")[0].trim().toLowerCase();
  if (h.startsWith("audio/") || h.startsWith("video/")) return h;
  return "video/webm";
}

/**
 * Matroska/WebM starts with EBML `0x1A45DFA3`. Use `video/webm` for the Blob: many browsers
 * refuse Opus-in-WebM in `<audio>` but play it on `<video>` (even audio-only bitstreams).
 */
function hasKnownMediaMagic(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 4) return false;
  const u = new Uint8Array(buf.slice(0, 4));
  if (u[0] === 0x1a && u[1] === 0x45 && u[2] === 0xdf && u[3] === 0xa3) return true;
  if (buf.byteLength >= 3) {
    const h = new Uint8Array(buf.slice(0, 3));
    if (h[0] === 0x49 && h[1] === 0x44 && h[2] === 0x33) return true;
  }
  if (buf.byteLength >= 2) {
    const h = new Uint8Array(buf.slice(0, 2));
    if (h[0] === 0xff && (h[1] & 0xe0) === 0xe0) return true;
  }
  if (buf.byteLength >= 12) {
    const h = new Uint8Array(buf.slice(0, 12));
    if (h[0] === 0x52 && h[1] === 0x49 && h[2] === 0x46 && h[3] === 0x46 && h[8] === 0x57 && h[9] === 0x41 && h[10] === 0x56 && h[11] === 0x45) {
      return true;
    }
  }
  return false;
}

function sniffMimeFromBytes(buf: ArrayBuffer, url: string, contentTypeHeader: string | null): string {
  if (buf.byteLength < 4) return sniffAudioMimeFromUrl(url, contentTypeHeader);
  const u = new Uint8Array(buf.slice(0, 4));
  if (u[0] === 0x1a && u[1] === 0x45 && u[2] === 0xdf && u[3] === 0xa3) {
    return "video/webm";
  }
  if (buf.byteLength >= 3) {
    const h = new Uint8Array(buf.slice(0, 3));
    if (h[0] === 0x49 && h[1] === 0x44 && h[2] === 0x33) return "audio/mpeg";
  }
  if (buf.byteLength >= 2) {
    const h = new Uint8Array(buf.slice(0, 2));
    if (h[0] === 0xff && (h[1] & 0xe0) === 0xe0) return "audio/mpeg";
  }
  if (buf.byteLength >= 12) {
    const h = new Uint8Array(buf.slice(0, 12));
    if (h[0] === 0x52 && h[1] === 0x49 && h[2] === 0x46 && h[3] === 0x46 && h[8] === 0x57 && h[9] === 0x41 && h[10] === 0x56 && h[11] === 0x45) {
      return "audio/wav";
    }
  }
  return sniffAudioMimeFromUrl(url, contentTypeHeader);
}

type VoiceMessagePlayerProps = {
  src: string;
  hintDurationSec?: number;
  isMine: boolean;
};

export default function VoiceMessagePlayer({ src, hintDurationSec, isMine }: VoiceMessagePlayerProps) {
  const mediaRef = useRef<HTMLVideoElement | null>(null);
  /** Ignore decode/network errors until a normalized blob is attached (avoids noise from the pre-fetch HTTP `src`). */
  const reportMediaErrorsRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(hintDurationSec ?? 0);
  const [current, setCurrent] = useState(0);
  const [rate, setRate] = useState<1 | 2>(1);
  const [playError, setPlayError] = useState<string | null>(null);
  const [resolvedSrc, setResolvedSrc] = useState(src);
  const [blobStatus, setBlobStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");

  useEffect(() => {
    setDuration(hintDurationSec ?? 0);
    setPlayError(null);
    setPlaying(false);
    setCurrent(0);
  }, [hintDurationSec, src]);

  useEffect(() => {
    reportMediaErrorsRef.current = blobStatus === "ready";
  }, [blobStatus]);

  useEffect(() => {
    const el = mediaRef.current;
    if (!el) return;
    el.playbackRate = rate;
  }, [rate]);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | undefined;

    if (!needsBytesNormalize(src)) {
      setResolvedSrc(src);
      setBlobStatus("ready");
      return () => {
        cancelled = true;
      };
    }

    setBlobStatus("loading");
    setResolvedSrc("");

    void (async () => {
      try {
        const token = window.localStorage.getItem("accessToken");
        const headers: HeadersInit = {};
        if (token && isBackendOriginAbsoluteUrl(src)) {
          (headers as Record<string, string>).Authorization = `Bearer ${token}`;
        }
        const res = await fetch(src, { headers });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        if (buf.byteLength === 0) throw new Error("Empty audio file");
        const ct = res.headers.get("content-type");
        if (!hasKnownMediaMagic(buf)) {
          const ctLow = (ct ?? "").toLowerCase();
          if (ctLow.includes("text/html") || ctLow.includes("application/json")) {
            throw new Error("Voice URL returned a web page or JSON instead of audio (check login or path)");
          }
        }
        const mime = sniffMimeFromBytes(buf, src, ct);
        const blob = new Blob([buf], { type: mime });
        objectUrl = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        setResolvedSrc(objectUrl);
        setBlobStatus("ready");
        chatDebug("voice blob ready", { src, mime, bytes: buf.byteLength });
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        setBlobStatus("error");
        setResolvedSrc(src);
        setPlayError(`Load failed: ${msg}`);
        console.warn("[voice] fetch blob failed", { src, err: e });
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  useEffect(() => {
    const el = mediaRef.current;
    if (!el || !resolvedSrc) return;
    el.load();
    setCurrent(0);
    setPlaying(false);
  }, [resolvedSrc]);

  const waitForCanPlay = useCallback((el: HTMLVideoElement): Promise<void> => {
    /**
     * Short WebM/Opus voice blobs often never reach `HAVE_FUTURE_DATA` before `play()` can still
     * succeed — waiting only for that caused false 12s timeouts.
     */
    const readyEnough = (): boolean => {
      if (el.error) return false;
      if (el.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return true;
      if (el.readyState >= HTMLMediaElement.HAVE_METADATA) {
        const d = el.duration;
        return Number.isFinite(d) && d > 0;
      }
      return false;
    };
    if (readyEnough()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const ms = 20000;
      let settled = false;
      const cleanup = (): void => {
        window.clearTimeout(timer);
        el.removeEventListener("canplay", onReady);
        el.removeEventListener("loadeddata", onReady);
        el.removeEventListener("loadedmetadata", onReady);
        el.removeEventListener("error", onErr);
      };
      const finishOk = (): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };
      const finishErr = (err: Error): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err);
      };
      const timer = window.setTimeout(() => {
        finishErr(
          new Error(
            "Voice preview did not become ready in time. Use Open file, or try again."
          )
        );
      }, ms);
      const onReady = (): void => {
        if (readyEnough()) finishOk();
      };
      const onErr = (): void => {
        const code = el.error?.code;
        finishErr(
          new Error(
            code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED ? "Format not supported" : "Media load error"
          )
        );
      };
      el.addEventListener("canplay", onReady);
      el.addEventListener("loadeddata", onReady);
      el.addEventListener("loadedmetadata", onReady);
      el.addEventListener("error", onErr, { once: true });
      queueMicrotask(onReady);
    });
  }, []);

  const toggle = useCallback(() => {
    const el = mediaRef.current;
    if (!el || !resolvedSrc || blobStatus !== "ready") return;
    setPlayError(null);
    if (!el.paused) {
      el.pause();
      return;
    }
    void (async () => {
      try {
        await waitForCanPlay(el);
        await el.play();
        setPlaying(true);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setPlaying(false);
        setPlayError(msg);
        console.warn("[voice] play() failed", { src: el.currentSrc || resolvedSrc, err });
        chatDebug("voice play() rejected", { src: el.currentSrc || resolvedSrc, message: msg });
      }
    })();
  }, [resolvedSrc, blobStatus, waitForCanPlay]);

  const barTint = isMine ? "bg-white/40" : "bg-slate-300";
  const activeTint = isMine ? "bg-white" : "bg-blue-500";

  return (
    <div className="relative z-10 mt-1 flex min-w-[200px] max-w-[260px] flex-col gap-2">
      {blobStatus === "loading" ? (
        <p className={`text-[10px] ${isMine ? "text-blue-100" : "text-slate-500"}`}>Preparing playback…</p>
      ) : null}

      {/* WebM/Opus: `<video>` + typed blob — `<audio>` often reports "no supported sources" for the same bytes. */}
      <video
        ref={mediaRef}
        src={resolvedSrc || undefined}
        preload="auto"
        playsInline
        className="pointer-events-none absolute left-0 top-0 h-8 w-8 overflow-hidden opacity-0"
        aria-hidden
        tabIndex={-1}
        onError={(e) => {
          if (!reportMediaErrorsRef.current) return;
          const el = e.currentTarget;
          const err = el.error;
          const hint =
            err?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
              ? "Format not supported or bad file"
              : err?.code === MediaError.MEDIA_ERR_NETWORK
                ? "Network / CORS / mixed content"
                : "Media error";
          setPlayError(hint);
          chatDebug("voice media error", {
            src: el.currentSrc || resolvedSrc,
            error: err ? { code: err.code, message: err.message } : null,
          });
        }}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setDuration(d);
          chatDebug("voice metadata", {
            src: resolvedSrc,
            duration: Number.isFinite(d) ? d : null,
          });
        }}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onEnded={() => {
          setPlaying(false);
          setCurrent(0);
          if (mediaRef.current) mediaRef.current.currentTime = 0;
        }}
        onPause={() => setPlaying(false)}
        onPlay={() => setPlaying(true)}
      />

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={blobStatus !== "ready" || !resolvedSrc}
          onClick={(e) => {
            e.stopPropagation();
            toggle();
          }}
          className={`flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full text-sm font-bold shadow disabled:cursor-not-allowed disabled:opacity-40 ${
            isMine ? "bg-white/25 text-white ring-1 ring-white/30" : "bg-blue-600 text-white ring-1 ring-blue-500/40"
          }`}
          aria-label={playing ? "Pause voice" : "Play voice"}
        >
          {playing ? "❚❚" : "▶"}
        </button>

        <button
          type="button"
          disabled={blobStatus !== "ready" || !resolvedSrc}
          className="flex min-w-0 flex-1 cursor-pointer flex-col gap-1 rounded-lg border border-transparent text-left outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/50 disabled:cursor-not-allowed disabled:opacity-40"
          onClick={(e) => {
            e.stopPropagation();
            toggle();
          }}
          aria-label="Play or pause voice (waveform area)"
        >
          <div className="pointer-events-none flex h-6 items-end gap-0.5">
            {Array.from({ length: 12 }).map((_, i) => (
              <span
                key={i}
                className={`w-1 rounded-full transition-colors ${playing ? `${activeTint} animate-pulse` : barTint}`}
                style={{
                  height: `${8 + ((i * 17) % 18)}px`,
                  animationDuration: `${0.45 + (i % 6) * 0.07}s`,
                }}
              />
            ))}
          </div>
          <div className={`pointer-events-none text-[11px] ${isMine ? "text-blue-100" : "text-slate-500"}`}>
            {formatDuration(current)} / {formatDuration(duration || hintDurationSec || 0)}
          </div>
        </button>

        <button
          type="button"
          className={`shrink-0 cursor-pointer rounded px-1.5 py-0.5 font-semibold ${
            isMine ? "bg-white/20 hover:bg-white/30" : "bg-slate-200 hover:bg-slate-300"
          }`}
          onClick={(e) => {
            e.stopPropagation();
            setRate((r) => (r === 1 ? 2 : 1));
          }}
        >
          {rate}x
        </button>
      </div>

      {playError ? (
        <p className={`text-[10px] leading-snug ${isMine ? "text-amber-100" : "text-amber-800"}`}>
          {playError}.{" "}
          <a href={src} target="_blank" rel="noreferrer" className="underline">
            Open file
          </a>
        </p>
      ) : null}
    </div>
  );
}
