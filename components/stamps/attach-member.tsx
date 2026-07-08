"use client";

import { useRef, useState, useTransition } from "react";
import { BrowserQRCodeReader } from "@zxing/browser";
import { attachMemberAction } from "@/app/(admin)/manage/actions";

// Staff control on the order page: attach a member by scanning their QR (camera)
// or keying in phone/email. On success the stamp is granted (now if the order is
// already completed, else at completion).
export function AttachMember({ token, attached }: { token: string; attached: boolean }) {
  const [scanning, setScanning] = useState(false);
  const [manual, setManual] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);

  function submit(identifier: string) {
    if (!identifier.trim()) return;
    start(async () => {
      const res = await attachMemberAction(token, identifier);
      setMsg(res.ok ? `Attached: ${res.displayName}` : res.error);
      if (res.ok) setManual("");
    });
  }

  async function startScan() {
    setMsg(null);
    setScanning(true);
    try {
      const reader = new BrowserQRCodeReader();
      controlsRef.current = await reader.decodeFromVideoDevice(
        undefined,
        videoRef.current!,
        (result) => {
          if (result) {
            controlsRef.current?.stop();
            setScanning(false);
            submit(result.getText());
          }
        },
      );
    } catch {
      setScanning(false);
      setMsg("Couldn't open the camera. Key in phone or email instead.");
    }
  }

  function stopScan() {
    controlsRef.current?.stop();
    setScanning(false);
  }

  return (
    <section className="rounded-2xl border border-border bg-white p-4">
      <h3 className="text-xs font-bold uppercase tracking-wider">
        {attached ? "Member attached" : "Attach member for stamp"}
      </h3>

      {!attached && (
        <>
          {scanning ? (
            <div className="mt-3 flex flex-col gap-2">
              <video ref={videoRef} className="w-full rounded-xl bg-black" />
              <button type="button" onClick={stopScan}
                className="h-10 rounded-xl border border-border text-xs font-bold uppercase tracking-wider">
                Cancel scan
              </button>
            </div>
          ) : (
            <button type="button" onClick={startScan} disabled={pending}
              className="mt-3 h-11 w-full rounded-2xl bg-foreground text-xs font-bold uppercase tracking-wider text-white disabled:opacity-70">
              Scan member QR
            </button>
          )}

          <div className="mt-3 flex gap-2">
            <input value={manual} onChange={(e) => setManual(e.target.value)}
              placeholder="Phone or email" disabled={pending}
              className="h-11 flex-1 rounded-xl border border-border px-3 text-sm" />
            <button type="button" onClick={() => submit(manual)} disabled={pending || !manual.trim()}
              className="h-11 rounded-xl border border-border px-4 text-xs font-bold uppercase tracking-wider disabled:opacity-70">
              Attach
            </button>
          </div>
        </>
      )}

      {msg && <p className="mt-2 text-xs">{msg}</p>}
    </section>
  );
}
