"use client";

import { useEffect, useRef, useState } from "react";
import * as fabric from "fabric";

export type StoryEditorModalProps = {
  open: boolean;
  file: File | null;
  busy?: boolean;
  onClose: () => void;
  onShare: (blob: Blob) => void | Promise<void>;
};

const CANVAS_W = 360;
const CANVAS_H = 640;
const TEAL = "#1E7F73";

const COLORS = ["#ffffff", "#1E7F73", "#0ea5e9", "#2563eb", "#0f172a"];

export default function StoryEditorModal({
  open,
  file,
  busy,
  onClose,
  onShare,
}: StoryEditorModalProps) {
  const canvasElRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<fabric.Canvas | null>(null);
  const [textColor, setTextColor] = useState<string>(COLORS[0]);

  useEffect(() => {
    if (!open || !file) return;
    const canvasEl = canvasElRef.current;
    if (!canvasEl) return;

    const canvas = new fabric.Canvas(canvasEl, {
      width: CANVAS_W,
      height: CANVAS_H,
      backgroundColor: "#000",
      preserveObjectStacking: true,
    });
    fabricRef.current = canvas;

    let cancelled = false;
    const reader = new FileReader();
    reader.onload = (ev) => {
      if (cancelled) return;
      const dataUrl = ev.target?.result;
      if (typeof dataUrl !== "string") return;

      fabric.FabricImage.fromURL(dataUrl).then((img) => {
        if (cancelled) return;
        const w = img.width ?? 1;
        const h = img.height ?? 1;
        const scale = Math.max(CANVAS_W / w, CANVAS_H / h);
        img.scale(scale);
        img.set({
          left: CANVAS_W / 2,
          top: CANVAS_H / 2,
          originX: "center",
          originY: "center",
        });
        canvas.backgroundImage = img;
        canvas.renderAll();
      });
    };
    reader.readAsDataURL(file);

    return () => {
      cancelled = true;
      canvas.dispose();
      fabricRef.current = null;
    };
  }, [open, file]);

  const onAddText = () => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const text = new fabric.IText("Tap to edit", {
      left: CANVAS_W / 2,
      top: CANVAS_H / 2,
      originX: "center",
      originY: "center",
      fontFamily: "Arial, Helvetica, sans-serif",
      fontWeight: "700",
      fontSize: 34,
      fill: textColor,
      stroke: "rgba(0,0,0,0.55)",
      strokeWidth: 1.25,
      paintFirst: "stroke",
      shadow: new fabric.Shadow({
        color: "rgba(0,0,0,0.45)",
        blur: 6,
        offsetX: 0,
        offsetY: 2,
      }),
      editable: true,
    });
    canvas.add(text);
    canvas.setActiveObject(text);
    canvas.renderAll();
  };

  const onPickColor = (color: string) => {
    setTextColor(color);
    const canvas = fabricRef.current;
    if (!canvas) return;
    const active = canvas.getActiveObject();
    if (active && active.type === "i-text") {
      (active as fabric.IText).set("fill", color);
      canvas.requestRenderAll();
    }
  };

  const onDeleteSelected = () => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const active = canvas.getActiveObject();
    if (!active) return;
    canvas.remove(active);
    canvas.discardActiveObject();
    canvas.requestRenderAll();
  };

  const onShareClick = async () => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    canvas.discardActiveObject();
    canvas.renderAll();
    const dataUrl = canvas.toDataURL({
      format: "jpeg",
      quality: 0.92,
      multiplier: 2,
    });
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    await onShare(blob);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/85 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Edit story"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        className="flex max-h-[95vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-slate-900 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3">
          <h3 className="text-base font-semibold text-white">New story</h3>
          <button
            type="button"
            className="flex h-9 w-9 items-center justify-center rounded-full text-2xl leading-none text-white/80 transition hover:bg-white/10 disabled:opacity-40"
            aria-label="Close"
            disabled={busy}
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="flex flex-col items-center bg-black px-4 pb-3">
          <canvas
            ref={canvasElRef}
            width={CANVAS_W}
            height={CANVAS_H}
            className="rounded-xl shadow-lg"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-white/10 px-4 py-3">
          <button
            type="button"
            onClick={onAddText}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/20"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <polyline points="4 7 4 4 20 4 20 7" />
              <line x1="9" y1="20" x2="15" y2="20" />
              <line x1="12" y1="4" x2="12" y2="20" />
            </svg>
            Text
          </button>

          <button
            type="button"
            onClick={onDeleteSelected}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/20"
            aria-label="Remove selected"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6M14 11v6" />
            </svg>
          </button>

          <div className="ml-auto flex items-center gap-1.5">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Set text color ${c}`}
                onClick={() => onPickColor(c)}
                className={`h-7 w-7 rounded-full border-2 transition ${
                  textColor === c ? "scale-110 border-white" : "border-white/40 hover:border-white/70"
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>

        <div className="flex gap-2 border-t border-white/10 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="flex-1 rounded-xl bg-white/10 px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-white/20 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void onShareClick()}
            disabled={busy}
            className="flex-1 rounded-xl px-3 py-2.5 text-sm font-semibold text-white shadow-md transition active:scale-[0.99] disabled:opacity-60"
            style={{ backgroundColor: TEAL }}
          >
            {busy ? "Sharing…" : "Share Now"}
          </button>
        </div>
      </div>
    </div>
  );
}
