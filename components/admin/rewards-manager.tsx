"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { filterDigits } from "@/lib/input";
import { capitalizeWords, capitalizeFirst } from "@/lib/format";
import { ImageUpload } from "@/components/admin/image-upload";
import { useUnsavedChanges, useIntentionalReload } from "@/components/admin/unsaved-changes";
import type {
  AdminLoyaltySettings,
  AdminMilestone,
  AdminRewardItem,
  AdminTier,
} from "@/lib/rewards/types";
import type { AdminProduct } from "@/lib/menu/types";
import { saveRewardsConfig } from "@/app/(admin)/admin/rewards/actions";

// One client-side working copy of the whole Rewards CMS. Every field, toggle,
// add, and delete edits local state only; nothing persists until the single
// floating Save bar commits the lot. Cancel snaps everything back to `initial`.

type SettingsDraft = { beansPerRinggit: string; referralBeans: string; voucher: string };
type TierDraft = { key: string; id?: string; name: string; threshold: string; perk: string; isArchived: boolean };
type MilestoneDraft = {
  key: string; id?: string; label: string; displayLabel: string;
  beans: string; triggerDay: string; repeat: string; isActive: boolean; deleted: boolean;
};
type RewardDraft = {
  key: string; id?: string; name: string; cost: string;
  productId: string; imageUrl: string | null; isActive: boolean; isArchived: boolean;
};

type Initial = {
  settings: AdminLoyaltySettings;
  tiers: AdminTier[];
  milestones: AdminMilestone[];
  rewards: AdminRewardItem[];
};

function seedSettings(s: AdminLoyaltySettings): SettingsDraft {
  return { beansPerRinggit: String(s.beansPerRinggit), referralBeans: String(s.referralBeans), voucher: s.referralVoucherLabel };
}
function seedTiers(tiers: AdminTier[]): TierDraft[] {
  return tiers.map((t) => ({ key: t.id, id: t.id, name: t.name, threshold: String(t.threshold), perk: t.perk, isArchived: t.isArchived }));
}
function seedMilestones(ms: AdminMilestone[]): MilestoneDraft[] {
  return ms.map((m) => ({
    key: m.id, id: m.id, label: m.label, displayLabel: m.displayLabel,
    beans: String(m.beans), triggerDay: String(m.triggerDay),
    repeat: m.repeatEveryDays == null ? "" : String(m.repeatEveryDays),
    isActive: m.isActive, deleted: false,
  }));
}
function seedRewards(rs: AdminRewardItem[]): RewardDraft[] {
  return rs.map((r) => ({
    key: r.id, id: r.id, name: r.name, cost: String(r.cost),
    productId: r.productId, imageUrl: r.imageUrl, isActive: r.isActive, isArchived: r.isArchived,
  }));
}

// Comparable shape (drop React keys) for dirty detection.
function strip<T extends { key: string }>(row: T) {
  const { key, ...rest } = row;
  void key;
  return rest;
}
function serialize(s: SettingsDraft, t: TierDraft[], m: MilestoneDraft[], r: RewardDraft[]): string {
  return JSON.stringify({ s, t: t.map(strip), m: m.map(strip), r: r.map(strip) });
}

export function RewardsManager({ initial, products }: { initial: Initial; products: AdminProduct[] }) {
  const activeProducts = products.filter((p) => !p.isArchived);
  // Menu image per product, so a reward defaults to its product's image (mirrors
  // the storefront fallback: reward image → product image → generic placeholder).
  const productImage = new Map(products.map((p) => [p.id, p.imageUrl]));

  const [settings, setSettings] = useState<SettingsDraft>(() => seedSettings(initial.settings));
  const [tiers, setTiers] = useState<TierDraft[]>(() => seedTiers(initial.tiers));
  const [milestones, setMilestones] = useState<MilestoneDraft[]>(() => seedMilestones(initial.milestones));
  const [rewards, setRewards] = useState<RewardDraft[]>(() => seedRewards(initial.rewards));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const intentionalReload = useIntentionalReload();

  const keyRef = useRef(0);
  const nextKey = () => `new-${++keyRef.current}`;

  // Snapshot of the as-loaded state; the bar shows only when we differ from it.
  const [baseline] = useState(() =>
    serialize(seedSettings(initial.settings), seedTiers(initial.tiers), seedMilestones(initial.milestones), seedRewards(initial.rewards)),
  );
  const current = serialize(settings, tiers, milestones, rewards);
  const dirty = current !== baseline;
  useUnsavedChanges(dirty);
  const changes = countChanges(initial, settings, tiers, milestones, rewards);

  // Keep the bar mounted through its drop-out animation. Show immediately when
  // dirty (adjust-during-render, not an effect); hide on a delay once clean so
  // the exit keyframe can play before we unmount.
  const [mounted, setMounted] = useState(dirty);
  if (dirty && !mounted) setMounted(true);
  useEffect(() => {
    if (dirty) return; // shown via the render-time guard above
    const t = setTimeout(() => setMounted(false), 320); // covers naise-bar-out
    return () => clearTimeout(t);
  }, [dirty]);

  // Freeze the count while clean so the label doesn't flash "0 changes" as the
  // bar animates away.
  const [shownChanges, setShownChanges] = useState(changes);
  if (dirty && shownChanges !== changes) setShownChanges(changes);

  function updateTier(key: string, patch: Partial<TierDraft>) {
    setTiers((prev) => prev.map((t) => (t.key === key ? { ...t, ...patch } : t)));
  }
  function updateMilestone(key: string, patch: Partial<MilestoneDraft>) {
    setMilestones((prev) => prev.map((m) => (m.key === key ? { ...m, ...patch } : m)));
  }
  function updateReward(key: string, patch: Partial<RewardDraft>) {
    setRewards((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function reset() {
    setSettings(seedSettings(initial.settings));
    setTiers(seedTiers(initial.tiers));
    setMilestones(seedMilestones(initial.milestones));
    setRewards(seedRewards(initial.rewards));
    setError(null);
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await saveRewardsConfig({
        settings: {
          beansPerRinggit: Number(settings.beansPerRinggit || "0"),
          referralBeans: Number(settings.referralBeans || "0"),
          referralVoucherLabel: settings.voucher,
        },
        // Drop blank new rows so an empty "Add" never blocks the save.
        tiers: tiers
          .filter((t) => t.id || t.name.trim())
          .map((t) => ({ id: t.id, name: t.name, threshold: Number(t.threshold || "0"), perk: t.perk, isArchived: t.isArchived })),
        milestones: milestones
          .filter((m) => m.id || m.label.trim())
          .map((m) => ({
            id: m.id, label: m.label, displayLabel: m.displayLabel,
            beans: Number(m.beans || "0"), triggerDay: Number(m.triggerDay || "0"),
            repeatEveryDays: m.repeat.trim() === "" ? null : Number(m.repeat),
            isActive: m.isActive, deleted: m.deleted,
          })),
        rewards: rewards
          .filter((r) => r.id || r.name.trim())
          .map((r) => ({
            id: r.id, name: r.name, cost: Number(r.cost || "0"),
            productId: r.productId, imageUrl: r.imageUrl, isActive: r.isActive, isArchived: r.isArchived,
          })),
      });
      // Reload to re-pull fresh rows (with new ids) and clear the dirty state.
      if (res.ok) intentionalReload();
      else setError(res.error);
    });
  }

  const activeTiers = tiers.filter((t) => !t.isArchived).length;
  const activeMilestones = milestones.filter((m) => !m.deleted && m.isActive).length;
  const liveRewards = rewards.filter((r) => r.isActive && !r.isArchived).length;
  const visibleMilestones = milestones.filter((m) => !m.deleted);

  return (
    <>
      {/* Loyalty settings */}
      <Section title="Loyalty settings" hint="Earning">
        <div className="flex flex-col gap-1.5">
          <Label>Beans per RM1</Label>
          <Input
            inputMode="numeric"
            value={settings.beansPerRinggit}
            onChange={(e) => setSettings((s) => ({ ...s, beansPerRinggit: filterDigits(e.target.value) }))}
            className="w-28 font-mono tabular-nums"
          />
          <p className="text-xs text-muted-foreground">Applies to future orders only. The Beans ledger is immutable.</p>
        </div>
        <div className="flex gap-3">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label>Referral beans</Label>
            <Input
              inputMode="numeric"
              value={settings.referralBeans}
              onChange={(e) => setSettings((s) => ({ ...s, referralBeans: filterDigits(e.target.value) }))}
              className="font-mono tabular-nums"
            />
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <Label>Voucher label</Label>
            <Input value={settings.voucher} onChange={(e) => setSettings((s) => ({ ...s, voucher: capitalizeWords(e.target.value) }))} placeholder="RM5 Voucher" />
          </div>
        </div>
      </Section>

      {/* Tiers */}
      <Section title="Tiers" hint={`${activeTiers} active`}>
        {tiers.length === 0 ? (
          <EmptyState>No tiers yet. Add your first below.</EmptyState>
        ) : (
          <div className="flex flex-col gap-2.5">
            {tiers.map((t) => (
              <div key={t.key} className={cn("flex flex-col gap-2 rounded-2xl border border-border bg-card p-3", t.isArchived && "opacity-60")}>
                <div className="flex items-center gap-2">
                  <Input value={t.name} onChange={(e) => updateTier(t.key, { name: capitalizeWords(e.target.value) })} placeholder="Name" className="flex-1" />
                  {!t.id && <NewPill />}
                </div>
                <div className="flex gap-2">
                  <Input value={t.perk} onChange={(e) => updateTier(t.key, { perk: capitalizeFirst(e.target.value) })} placeholder="Perk description" className="flex-1" />
                  <div className="relative w-28 shrink-0">
                    <Input
                      inputMode="numeric"
                      value={t.threshold}
                      onChange={(e) => updateTier(t.key, { threshold: filterDigits(e.target.value) })}
                      placeholder="0"
                      className="w-full pr-12 font-mono tabular-nums"
                    />
                    <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">Beans</span>
                  </div>
                </div>
                <div className="flex">
                  {t.id ? (
                    <Button variant="outline" size="sm" className="rounded-full" onClick={() => updateTier(t.key, { isArchived: !t.isArchived })}>
                      {t.isArchived ? "Restore" : "Archive"}
                    </Button>
                  ) : (
                    <Button variant="ghost" size="sm" className="rounded-full text-muted-foreground" onClick={() => setTiers((prev) => prev.filter((x) => x.key !== t.key))}>
                      Remove
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        <AddButton onClick={() => setTiers((prev) => [...prev, { key: nextKey(), name: "", threshold: "", perk: "", isArchived: false }])}>
          Add tier
        </AddButton>
      </Section>

      {/* Streak milestones */}
      <Section title="Streak milestones" hint={`${activeMilestones} active`}>
        <p className="text-xs text-muted-foreground">
          Fires when the streak reaches the trigger day. Set a repeat (e.g. 7) for a weekly/monthly bonus;
          leave it empty for a one-time award at exactly the trigger day.
        </p>
        {visibleMilestones.length === 0 ? (
          <EmptyState>No milestones yet. Add your first below.</EmptyState>
        ) : (
          <div className="flex flex-col gap-2.5">
            {visibleMilestones.map((m) => (
              <div key={m.key} className={cn("flex flex-col gap-2 rounded-2xl border border-border bg-card p-3", !m.isActive && "opacity-60")}>
                <div className="flex items-center gap-2">
                  <Input value={m.label} onChange={(e) => updateMilestone(m.key, { label: capitalizeWords(e.target.value) })} placeholder="Ledger label (e.g. 3-Day Streak Bonus)" className="flex-1" />
                  {!m.id && <NewPill />}
                </div>
                <Input value={m.displayLabel} onChange={(e) => updateMilestone(m.key, { displayLabel: capitalizeWords(e.target.value) })} placeholder="Card label (e.g. 50 Beans)" />
                <div className="flex items-center gap-2">
                  <Input inputMode="numeric" value={m.beans} onChange={(e) => updateMilestone(m.key, { beans: filterDigits(e.target.value) })} placeholder="Beans" className="flex-1 font-mono tabular-nums" />
                  <Input inputMode="numeric" value={m.triggerDay} onChange={(e) => updateMilestone(m.key, { triggerDay: filterDigits(e.target.value) })} placeholder="Day" className="w-16 font-mono tabular-nums" />
                  <Input inputMode="numeric" value={m.repeat} onChange={(e) => updateMilestone(m.key, { repeat: filterDigits(e.target.value) })} placeholder="Repeat" className="w-16 font-mono tabular-nums" />
                </div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    Active
                    <Switch checked={m.isActive} onCheckedChange={(v) => updateMilestone(m.key, { isActive: v })} />
                  </label>
                  <Button
                    variant="destructive"
                    size="icon-sm"
                    className="ml-auto rounded-full"
                    aria-label="Delete milestone"
                    onClick={() => (m.id ? updateMilestone(m.key, { deleted: true }) : setMilestones((prev) => prev.filter((x) => x.key !== m.key)))}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        <AddButton onClick={() => setMilestones((prev) => [...prev, { key: nextKey(), label: "", displayLabel: "", beans: "", triggerDay: "", repeat: "", isActive: true, deleted: false }])}>
          Add milestone
        </AddButton>
      </Section>

      {/* Reward catalog */}
      <Section title="Reward catalog" hint={`${liveRewards} live`}>
        {rewards.length === 0 ? (
          <EmptyState>No rewards yet. Add your first below.</EmptyState>
        ) : (
          <div className="flex flex-col gap-2.5">
            {rewards.map((r) => (
              <div key={r.key} className={cn("flex flex-col gap-3 rounded-2xl border border-border bg-card p-3", r.isArchived && "opacity-60")}>
                <div className="flex items-center justify-between gap-2">
                  <ImageUpload
                    value={r.imageUrl}
                    onChange={(url) => updateReward(r.key, { imageUrl: url })}
                    placeholder={productImage.get(r.productId) ?? undefined}
                    alt={r.name || "Reward image"}
                  />
                  {!r.id && <NewPill />}
                </div>
                <div className="flex gap-2">
                  <Input value={r.name} onChange={(e) => updateReward(r.key, { name: capitalizeWords(e.target.value) })} placeholder="Name" className="flex-1" />
                  <Input inputMode="numeric" value={r.cost} onChange={(e) => updateReward(r.key, { cost: filterDigits(e.target.value) })} placeholder="Beans" className="w-24 font-mono tabular-nums" />
                </div>
                <select
                  value={r.productId}
                  onChange={(e) => updateReward(r.key, { productId: e.target.value })}
                  className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {activeProducts.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    Active
                    <Switch checked={r.isActive} onCheckedChange={(v) => updateReward(r.key, { isActive: v })} />
                  </label>
                  {r.id ? (
                    <Button variant="outline" size="sm" className="ml-auto rounded-full" onClick={() => updateReward(r.key, { isArchived: !r.isArchived })}>
                      {r.isArchived ? "Restore" : "Archive"}
                    </Button>
                  ) : (
                    <Button variant="ghost" size="sm" className="ml-auto rounded-full text-muted-foreground" onClick={() => setRewards((prev) => prev.filter((x) => x.key !== r.key))}>
                      Remove
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        <AddButton
          onClick={() => setRewards((prev) => [...prev, { key: nextKey(), name: "", cost: "", productId: activeProducts[0]?.id ?? "", imageUrl: null, isActive: true, isArchived: false }])}
        >
          Add reward
        </AddButton>
      </Section>

      {/* One floating commit bar for the whole page — rises in when dirty, drops
          out when changes are cancelled or saved. */}
      {mounted && (
        <div
          className={cn(
            "sticky bottom-4 z-10 rounded-2xl border border-border bg-background/85 p-3 shadow-lg backdrop-blur",
            dirty ? "naise-bar-in" : "naise-bar-out",
          )}
        >
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium">
              {shownChanges} unsaved {shownChanges === 1 ? "change" : "changes"}
            </span>
            <div className="ml-auto flex gap-2">
              <Button variant="outline" className="h-11 rounded-full px-5" onClick={reset} disabled={pending}>
                Cancel
              </Button>
              <Button className="h-11 rounded-full px-6" onClick={save} disabled={pending}>
                {pending ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </div>
          {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        </div>
      )}
    </>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-heading text-base font-semibold">{title}</h2>
        {hint && <span className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card/50 px-4 py-8 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function AddButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-fit items-center gap-1 rounded-sm text-xs font-semibold text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <Plus className="size-4" /> {children}
    </button>
  );
}

function NewPill() {
  return (
    <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-primary">
      New
    </span>
  );
}

// Rough count of pending changes for the bar label: settings + each edited,
// new, or deleted row across the three lists.
function countChanges(
  initial: Initial,
  settings: SettingsDraft,
  tiers: TierDraft[],
  milestones: MilestoneDraft[],
  rewards: RewardDraft[],
): number {
  let n = 0;
  if (JSON.stringify(settings) !== JSON.stringify(seedSettings(initial.settings))) n++;

  const tb = new Map(seedTiers(initial.tiers).map((t) => [t.id, JSON.stringify(strip(t))]));
  for (const t of tiers) {
    if (!t.id) n++;
    else if (tb.get(t.id) !== JSON.stringify(strip(t))) n++;
  }

  const mb = new Map(seedMilestones(initial.milestones).map((m) => [m.id, JSON.stringify(strip(m))]));
  for (const m of milestones) {
    if (m.deleted) { if (m.id) n++; continue; }
    if (!m.id) n++;
    else if (mb.get(m.id) !== JSON.stringify(strip(m))) n++;
  }

  const rb = new Map(seedRewards(initial.rewards).map((r) => [r.id, JSON.stringify(strip(r))]));
  for (const r of rewards) {
    if (!r.id) n++;
    else if (rb.get(r.id) !== JSON.stringify(strip(r))) n++;
  }
  return n;
}
