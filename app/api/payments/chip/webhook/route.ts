import { NextResponse } from "next/server";
import { verifyChipSignature } from "@/lib/payments/chip/signature";
import { markOrderPaid } from "@/lib/orders/store";
import { settlePaidOrder } from "@/app/(customer)/checkout/actions";

// node:crypto (signature verify) needs the Node.js runtime, not Edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// CHIP success_callback / webhook. ALWAYS returns 200 — CHIP retries any non-200
// (up to 8 times over ~36h) and may deliver duplicates, so processing must be
// idempotent and a rejected/duplicate delivery must still 200 to stop retries.
export async function POST(req: Request) {
  // Read the RAW body first — the signature is over the exact bytes; parsing
  // then reserializing JSON would break verification.
  const rawBody = await req.text();
  const signature = req.headers.get("X-Signature");

  if (!verifyChipSignature(rawBody, signature)) {
    // Unverified — do not process, but 200 so CHIP doesn't hammer retries.
    console.error("CHIP webhook: signature verification failed");
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  let payload: { event_type?: string; id?: string; status?: string };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    console.error("CHIP webhook: unparseable body");
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  // The callback payload is a Purchase snapshot; the paid event carries status
  // "paid" (webhooks also send event_type "purchase.paid"). Accept either signal.
  const isPaid = payload.status === "paid" || payload.event_type === "purchase.paid";
  const chipId = payload.id;
  if (!isPaid || !chipId) {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  // Idempotency lives in markOrderPaid: it only flips awaiting_payment → pending
  // and returns null if the order is missing or already advanced. A duplicate
  // delivery finds nothing to do, so we skip settlement.
  const order = await markOrderPaid(chipId);
  if (!order) {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  // Freshly paid — settle rewards + notify staff (best-effort inside settle).
  try {
    await settlePaidOrder(order.token);
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Unknown error";
    console.error(`CHIP webhook: settle failed for ${order.orderNumber}: ${reason}`);
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
