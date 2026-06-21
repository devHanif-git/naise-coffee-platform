"use client";

import { useState, useTransition } from "react";
import { SmartImage } from "@/components/ui/smart-image";
import { images } from "@/constants/images";
import { uploadProductImage } from "@/app/(admin)/admin/menu/actions";

export function ImageUpload({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (url: string | null) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    const fd = new FormData();
    fd.set("file", file);
    startTransition(async () => {
      try {
        const res = await uploadProductImage(fd);
        if (res.ok) onChange(res.url);
        else setError(res.error);
      } catch {
        setError("Upload failed. Please try again.");
      }
    });
  }

  return (
    <div className="flex items-center gap-3">
      <div className="relative size-20 shrink-0 overflow-hidden rounded-xl border border-border bg-muted">
        <SmartImage
          src={value ?? images.coffeeWithLogo}
          alt="Product image"
          fill
          sizes="80px"
          className="object-contain"
        />
      </div>
      <div className="flex flex-col items-start gap-1.5">
        <label className="cursor-pointer rounded-full border border-border px-3 py-1.5 text-xs font-semibold outline-none transition-colors hover:bg-muted focus-within:ring-3 focus-within:ring-ring/50">
          {pending ? "Uploading..." : value ? "Replace image" : "Upload image"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={onPick}
            disabled={pending}
          />
        </label>
        {value && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="rounded-sm text-xs font-semibold text-muted-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Remove
          </button>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </div>
  );
}
