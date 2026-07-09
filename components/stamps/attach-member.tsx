"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { BrowserQRCodeReader } from "@zxing/browser";
import { BadgeCheck, Loader2, QrCode, Search, UserPlus, X } from "lucide-react";
import { attachMemberAction, searchMembersAction } from "@/app/(admin)/manage/actions";
import type { MemberSearchResult } from "@/types/reward";
import { cn } from "@/lib/utils";

// Staff control on the order page for the loyalty stamp.
//
// - Member already on the order: a slim one-line note showing who the stamp goes
//   to. No controls (per product decision, no re-bind).
// - No member: staff bind one by scanning the member QR (camera) OR searching by
//   partial name / phone / email and tapping a result. On success the stamp is
//   granted (now if the order is already completed, else at completion).
export function AttachMember({
  token,
  attached,
  memberName,
}: {
  token: string;
  attached: boolean;
  memberName?: string;
}) {
  const [scanning, setScanning] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MemberSearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  const [searching, startSearch] = useTransition();
  const [attaching, startAttach] = useTransition();
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);

  // Release the camera if the component unmounts mid-scan (navigation, order
  // refresh, or the parent hiding this control). Otherwise stop() only runs on
  // Cancel or a successful decode, leaving the camera track live.
  useEffect(() => () => controlsRef.current?.stop(), []);

  function runSearch() {
    const q = query.trim();
    setMsg(null);
    setErr(false);
    if (q.length < 2) {
      setResults([]);
      setSearched(true);
      return;
    }
    startSearch(async () => {
      const res = await searchMembersAction(q);
      if (res.ok) {
        setResults(res.members);
      } else {
        setResults([]);
        setErr(true);
        setMsg(res.error);
      }
      setSearched(true);
    });
  }

  function attach(identifier: string) {
    if (!identifier.trim()) return;
    startAttach(async () => {
      const res = await attachMemberAction(token, identifier);
      setErr(!res.ok);
      setMsg(res.ok ? `Attached: ${res.displayName}` : res.error);
      if (res.ok) {
        setResults([]);
        setQuery("");
        setSearched(false);
      }
    });
  }

  async function startScan() {
    setMsg(null);
    setErr(false);
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
            attach(result.getText());
          }
        },
      );
    } catch {
      setScanning(false);
      setErr(true);
      setMsg("Couldn't open the camera. Search by phone, email, or name instead.");
    }
  }

  function stopScan() {
    controlsRef.current?.stop();
    setScanning(false);
  }

  // Attached: slim one-line note. Staff can already tell it's bound from the
  // absence of the bind UI, so this is just a quiet confirmation of who.
  if (attached) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <BadgeCheck className="size-3.5 shrink-0 text-emerald-600" strokeWidth={2.5} aria-hidden />
        Member
        {memberName && (
          <span className="font-semibold text-foreground">· {memberName}</span>
        )}
      </p>
    );
  }

  // Not attached: prompt staff to bind a member for the stamp.
  return (
    <section className="rounded-2xl border border-border bg-white p-4">
      <div className="flex items-center gap-2">
        <UserPlus className="size-4 text-foreground" strokeWidth={2} aria-hidden />
        <h3 className="text-xs font-bold uppercase tracking-wider">
          Attach member for stamp
        </h3>
      </div>
      <p className="mt-1 text-xs leading-snug text-muted-foreground">
        Scan the member&rsquo;s QR, or search by name, phone, or email and tap a
        result to grant the stamp for this order.
      </p>

      {scanning ? (
        <div className="mt-3 flex flex-col gap-2">
          <video ref={videoRef} className="w-full rounded-xl bg-black" />
          <button
            type="button"
            onClick={stopScan}
            className="flex h-11 items-center justify-center gap-2 rounded-2xl border border-border text-xs font-bold uppercase tracking-wider outline-none transition-colors hover:bg-neutral-50 focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <X className="size-4" strokeWidth={2.5} aria-hidden />
            Cancel scan
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={startScan}
          disabled={attaching}
          className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-black text-xs font-bold uppercase tracking-wider text-white outline-none transition-transform hover:scale-[1.01] active:scale-[0.99] focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-70"
        >
          <QrCode className="size-4" strokeWidth={2} aria-hidden />
          Scan member QR
        </button>
      )}

      <div className="mt-3 flex items-center gap-2">
        <div className="h-px flex-1 bg-border" />
        <span className="text-[0.625rem] font-semibold uppercase tracking-wider text-muted-foreground">
          or search
        </span>
        <div className="h-px flex-1 bg-border" />
      </div>

      {/* Search field: submit on Enter or the search button. */}
      <div className="mt-3 flex gap-2">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            strokeWidth={2}
            aria-hidden
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runSearch()}
            placeholder="Name, phone, or email"
            disabled={attaching}
            className="h-11 w-full rounded-xl border border-border pl-9 pr-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-70"
          />
        </div>
        <button
          type="button"
          onClick={runSearch}
          disabled={searching || attaching || query.trim().length < 2}
          className="flex h-11 items-center gap-1.5 rounded-xl border border-border px-4 text-xs font-bold uppercase tracking-wider outline-none transition-colors hover:bg-neutral-50 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-70"
        >
          {searching ? (
            <Loader2 className="size-4 animate-spin" strokeWidth={2.5} aria-hidden />
          ) : (
            "Search"
          )}
        </button>
      </div>

      {/* Results: tap a row to attach that member. */}
      {results.length > 0 && (
        <ul className="mt-3 flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border">
          {results.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => attach(m.id)}
                disabled={attaching}
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left outline-none transition-colors hover:bg-neutral-50 focus-visible:bg-neutral-50 disabled:opacity-70"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-[0.6875rem] font-bold uppercase text-foreground">
                  {m.displayName.charAt(0)}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-semibold">{m.displayName}</span>
                  <span className="truncate text-[0.6875rem] text-muted-foreground">
                    {[m.phone, m.email].filter(Boolean).join(" · ") || "No contact on file"}
                  </span>
                </span>
                <span className="shrink-0 text-[0.625rem] font-bold uppercase tracking-wider text-foreground">
                  Attach
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Empty state after a search that found nothing. */}
      {searched && !searching && results.length === 0 && !msg && (
        <p className="mt-3 text-xs text-muted-foreground">
          {query.trim().length < 2
            ? "Type at least 2 characters to search."
            : "No members match that search."}
        </p>
      )}

      {msg && (
        <p
          className={cn(
            "mt-2 text-xs font-medium",
            err ? "text-rose-600" : "text-emerald-700",
          )}
        >
          {msg}
        </p>
      )}
    </section>
  );
}
