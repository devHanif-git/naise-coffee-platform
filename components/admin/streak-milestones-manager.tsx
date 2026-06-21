"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { AdminMilestone } from "@/lib/rewards/types";
import { saveMilestone, setMilestoneActive, deleteMilestone } from "@/app/(admin)/admin/rewards/actions";

export function StreakMilestonesManager({ initial }: { initial: AdminMilestone[] }) {
  const [label, setLabel] = useState("");
  const [displayLabel, setDisplayLabel] = useState("");
  const [beans, setBeans] = useState("");
  const [triggerDay, setTriggerDay] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function reload() { startTransition(() => window.location.reload()); }
  function add() {
    setError(null);
    startTransition(async () => {
      const res = await saveMilestone({
        label, displayLabel, beans: Number(beans || "0"),
        triggerDay: Number(triggerDay || "0"),
        repeatEveryDays: repeat.trim() === "" ? null : Number(repeat),
      });
      if (res.ok) { setLabel(""); setDisplayLabel(""); setBeans(""); setTriggerDay(""); setRepeat(""); reload(); }
      else setError(res.error);
    });
  }

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4">
      <h2 className="font-heading text-base font-semibold">Streak milestones</h2>
      <p className="text-xs text-muted-foreground">
        Fires when the streak reaches the trigger day. Set a repeat (e.g. 7) for a weekly/monthly
        bonus; leave it empty for a one-time award at exactly the trigger day.
      </p>
      <div className="flex flex-col gap-2">
        {initial.length === 0 ? (
          <p className="text-sm text-muted-foreground">No milestones yet. Add your first milestone below.</p>
        ) : (
          initial.map((m) => <MilestoneRow key={m.id} milestone={m} onChanged={reload} />)
        )}
      </div>
      <div className="flex flex-col gap-2 border-t border-border pt-3">
        <Label>New milestone</Label>
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ledger label (e.g. 3-Day Streak Bonus)" />
        <Input value={displayLabel} onChange={(e) => setDisplayLabel(e.target.value)} placeholder="Card label (e.g. 50 Beans)" />
        <div className="flex gap-2">
          <Input inputMode="numeric" value={beans} onChange={(e) => setBeans(e.target.value)} placeholder="Beans" className="flex-1 font-mono tabular-nums" />
          <Input inputMode="numeric" value={triggerDay} onChange={(e) => setTriggerDay(e.target.value)} placeholder="Day" className="w-20 font-mono tabular-nums" />
          <Input inputMode="numeric" value={repeat} onChange={(e) => setRepeat(e.target.value)} placeholder="Repeat" className="w-20 font-mono tabular-nums" />
        </div>
        <Button onClick={add} className="self-start">Add milestone</Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </section>
  );
}

function MilestoneRow({ milestone, onChanged }: { milestone: AdminMilestone; onChanged: () => void }) {
  const [label, setLabel] = useState(milestone.label);
  const [displayLabel, setDisplayLabel] = useState(milestone.displayLabel);
  const [beans, setBeans] = useState(String(milestone.beans));
  const [triggerDay, setTriggerDay] = useState(String(milestone.triggerDay));
  const [repeat, setRepeat] = useState(milestone.repeatEveryDays == null ? "" : String(milestone.repeatEveryDays));
  const [, startTransition] = useTransition();

  return (
    <div className={cn("flex flex-col gap-2 rounded-xl border border-border bg-card p-3", !milestone.isActive && "opacity-50")}>
      <Input value={label} onChange={(e) => setLabel(e.target.value)} />
      <Input value={displayLabel} onChange={(e) => setDisplayLabel(e.target.value)} />
      <div className="flex items-center gap-2">
        <Input inputMode="numeric" value={beans} onChange={(e) => setBeans(e.target.value)} className="flex-1 font-mono tabular-nums" />
        <Input inputMode="numeric" value={triggerDay} onChange={(e) => setTriggerDay(e.target.value)} className="w-16 font-mono tabular-nums" />
        <Input inputMode="numeric" value={repeat} onChange={(e) => setRepeat(e.target.value)} placeholder="-" className="w-16 font-mono tabular-nums" />
      </div>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          Active
          <Switch checked={milestone.isActive} onCheckedChange={(v) => startTransition(async () => { await setMilestoneActive(milestone.id, v); onChanged(); })} />
        </label>
        <Button variant="destructive" size="icon-sm" onClick={() => startTransition(async () => { await deleteMilestone(milestone.id); onChanged(); })} aria-label="Delete milestone">
          <Trash2 className="size-4" />
        </Button>
        <Button size="sm" className="ml-auto" onClick={() => startTransition(async () => {
          await saveMilestone({ id: milestone.id, label, displayLabel, beans: Number(beans || "0"), triggerDay: Number(triggerDay || "0"), repeatEveryDays: repeat.trim() === "" ? null : Number(repeat) });
          onChanged();
        })}>
          Save
        </Button>
      </div>
    </div>
  );
}
