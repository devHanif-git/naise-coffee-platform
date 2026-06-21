"use client";

import { useCallback, useEffect, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import "react-easy-crop/react-easy-crop.css";
import { Loader2 } from "lucide-react";

// Draws the chosen crop area onto a square canvas and returns a JPEG File.
// Capped at 512px so we never upload an oversized avatar; the bucket accepts
// jpeg (uploadAvatar derives the extension from the File's type).
async function cropToFile(src: string, area: Area): Promise<File> {
  const image = await loadImage(src);
  const size = Math.min(Math.round(area.width), 512);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported.");
  ctx.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, size, size);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Crop failed."))),
      "image/jpeg",
      0.9,
    ),
  );
  return new File([blob], "avatar.jpg", { type: "image/jpeg" });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.addEventListener("load", () => resolve(img));
    img.addEventListener("error", () => reject(new Error("Image load failed.")));
    img.src = src;
  });
}

// Circular crop modal for the profile photo. Drag to position, slider/scroll to
// zoom; "Use photo" exports the framed square and hands it back as a File.
export function AvatarCropModal({
  src,
  onCancel,
  onCropped,
}: {
  src: string;
  onCancel: () => void;
  onCropped: (file: File) => void;
}) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onCropComplete = useCallback((_: Area, pixels: Area) => {
    setArea(pixels);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [busy, onCancel]);

  async function confirm() {
    if (!area || busy) return;
    setBusy(true);
    setError(null);
    try {
      onCropped(await cropToFile(src, area));
    } catch {
      setError("Couldn't crop the image. Please try another photo.");
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Crop photo"
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4 naise-fade"
    >
      <div className="flex w-full max-w-sm flex-col overflow-hidden rounded-3xl bg-white naise-pop">
        <div className="relative h-72 w-full bg-neutral-900">
          <Cropper
            image={src}
            crop={crop}
            zoom={zoom}
            aspect={1}
            cropShape="round"
            showGrid={false}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
          />
        </div>

        <div className="flex flex-col gap-4 px-6 pb-6 pt-5">
          <div className="flex items-center gap-3">
            <span className="text-[0.6875rem] font-bold uppercase tracking-wide text-muted-foreground">
              Zoom
            </span>
            <input
              type="range"
              min={1}
              max={3}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              aria-label="Zoom"
              className="h-1 flex-1 cursor-pointer accent-black"
            />
          </div>

          {error && (
            <p className="text-xs font-medium text-red-600" role="alert">
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={confirm}
            disabled={busy || !area}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-black text-xs font-semibold uppercase tracking-[0.15em] text-white outline-none transition-transform hover:scale-[1.01] active:scale-[0.99] focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {busy ? "Cropping…" : "Use photo"}
          </button>

          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="h-12 w-full rounded-2xl border border-border text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground outline-none transition-colors hover:bg-neutral-100 hover:text-foreground disabled:opacity-60"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
