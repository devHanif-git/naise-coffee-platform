import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendTelegramMessage } from "@/lib/telegram";
import { klDayKey } from "@/lib/analytics/range";

export const dynamic = "force-dynamic";

const HOUR_MS = 3_600_000;
const REMIND_EVERY_MS = 30 * 60_000; // 30 min between close reminders
const OPEN_NUDGE_AFTER_MS = 12 * HOUR_MS;

// Cron-only endpoint (Supabase pg_cron). Decides whether a reminder is due from
// shift state + last_reminder_at, so overlapping/retried hits never spam.
export async function POST(req: Request) {
  const secret = process.env.SHIFT_CRON_SECRET;
  if (!secret || req.headers.get("x-shift-cron-secret") !== secret) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const db = createAdminClient();
  const now = Date.now();

  // Is a shift open? If so, maybe send a "please close" reminder.
  const { data: open } = await db
    .from("shifts")
    .select("id, opened_at, last_reminder_at")
    .eq("status", "open")
    .maybeSingle();

  if (open) {
    const crossedDay =
      klDayKey(Date.parse(open.opened_at as string)) !== klDayKey(now);
    const last = open.last_reminder_at
      ? Date.parse(open.last_reminder_at as string)
      : 0;
    const due = crossedDay && now - last >= REMIND_EVERY_MS;
    if (due) {
      try {
        await sendTelegramMessage(
          "🔔 Shift still open — please close & count the drawer.",
        );
        await db
          .from("shifts")
          .update({ last_reminder_at: new Date(now).toISOString() })
          .eq("id", open.id);
      } catch (err) {
        const reason = err instanceof Error ? err.message : "Unknown error";
        console.error(`Shift close reminder failed: ${reason}`);
      }
    }
    return NextResponse.json({ ok: true, sent: due });
  }

  // No shift open: one-time "start a shift?" nudge 12h after the last close.
  const { data: lastClosed } = await db
    .from("shifts")
    .select("id, closed_at, last_reminder_at")
    .eq("status", "closed")
    .order("closed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastClosed?.closed_at) {
    const closedMs = Date.parse(lastClosed.closed_at as string);
    const alreadyNudged =
      lastClosed.last_reminder_at &&
      Date.parse(lastClosed.last_reminder_at as string) > closedMs;
    if (!alreadyNudged && now - closedMs >= OPEN_NUDGE_AFTER_MS) {
      try {
        await sendTelegramMessage(
          "☀️ Starting up? Open a shift to begin the drawer.",
        );
        await db
          .from("shifts")
          .update({ last_reminder_at: new Date(now).toISOString() })
          .eq("id", lastClosed.id);
      } catch (err) {
        const reason = err instanceof Error ? err.message : "Unknown error";
        console.error(`Shift open nudge failed: ${reason}`);
      }
      return NextResponse.json({ ok: true, sent: true });
    }
  }

  return NextResponse.json({ ok: true, sent: false });
}
