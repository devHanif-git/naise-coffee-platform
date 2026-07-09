# Loyalty Stamp Card + Vouchers — Manual E2E Test Checklist

Work through these **in order** — later tests rely on state from earlier ones.
Each test has: **Setup** → **Steps** → **Expect**. Tick the box when it passes.

**Accounts you'll need:**
- An **admin** login (for `/admin/promotions` + `/manage`).
- A **member/customer** login (for `/rewards` + online checkout). Call this "Member A".
- The **kiosk** (`/store`) opened with your 6-digit store passcode.

**Money reference (defaults):** RM-off = RM5, min spend = RM11, free-drink cap = RM12, card = 8 stamps, milestone at 4, voucher expiry 30 days. All editable in the CMS.

**Tip:** keep a Supabase SQL tab open. A few tests are easier to confirm with a quick query (given where useful).

---

## SECTION 1 — CMS control

### [ ] 1.1 Settings panel loads
- **Setup:** Sign in as admin.
- **Steps:** Go to `/admin/promotions`. Find the "Stamp Card & Vouchers" panel (above the promotions list).
- **Expect:** Shows an "Program enabled" toggle (on) + fields: Card size (8), Reward at (4), RM off (5.00), Min spend (11.00), Free drink cap (12.00), Voucher expiry (30).

### [ ] 1.2 Save persists
- **Steps:** Change Min spend to `11.00` (or nudge a value and set it back), click Save. Reload the page.
- **Expect:** "Saved" message; values persist after reload.

### [ ] 1.3 Program stays enabled
- **Steps:** Ensure "Program enabled" is ON and saved (we turn it off only in Section 7).
- **Expect:** Toggle on.

---

## SECTION 2 — Earn a stamp (online order, happy path)

### [ ] 2.1 Stamp card shows on /rewards
- **Setup:** Sign in as Member A. (If brand new, they start at 0 stamps.)
- **Steps:** Go to `/rewards`.
- **Expect:** A "Stamp Card" with 8 slots, header shows `0/8` (or the current count). A "Show my code" button reveals a QR. If the member already has stamps from earlier testing, note the starting count.

### [ ] 2.2 Place an online order with a paid drink
- **Steps:** As Member A, add **one normal (paid) drink** to cart, checkout, place the order (any payment method). Note the order number.
- **Expect:** Order confirmation shows. No stamp yet — the stamp lands on **completion**, not placement.

### [ ] 2.3 Staff completes the order → stamp lands
- **Setup:** Admin, open `/manage`.
- **Steps:** Find the order, mark every drink done / complete the order.
- **Expect:** On `/rewards` (Member A), the count rises by 1 with the **stamp-press animation** on the newest slot. (Reload if you don't have it open live.)

### [ ] 2.4 One stamp per order (idempotency)
- **Steps:** In `/manage`, if you can re-trigger completion, do so; otherwise just confirm the count didn't jump by 2.
- **Expect:** Still only **+1** for that order.
- **SQL check (optional):** `select count(*) from stamp_transactions where order_id = (select id from orders where order_number = '<NUMBER>') and is_reversal = false;` → returns `1`.

---

## SECTION 3 — Qualifying rule (free drink alone earns nothing)

### [ ] 3.1 Free-drink-only order → NO stamp
- **Setup:** Member A needs a redeemable Beans reward available (a free-drink reward in the catalog they can afford). If you can't set this up easily, skip to Section 4 and revisit.
- **Steps:** Build a cart whose **only** line is a redeemed free reward (no paid drink). Place + complete it.
- **Expect:** Stamp count does **NOT** increase. (An order must contain at least one paid drink to earn a stamp.)

### [ ] 3.2 Free drink + one paid drink → stamp DOES land
- **Steps:** Cart = the free reward **plus** one paid drink. Place + complete.
- **Expect:** Count **+1**.

---

## SECTION 4 — Milestone at 4 (RM-off voucher)

### [ ] 4.1 Reach 4 stamps
- **Steps:** Repeat Section 2 (place + complete paid orders) until Member A's count hits **4**. It resets visually per the card.
- **Expect:** At the 4th stamp, a "Reward unlocked" toast/flourish; an **RM5-off voucher** appears under "My Vouchers" on `/rewards` with "min RM11" and an expiry date.
- **SQL check (optional):** `select type, status, discount_amount, min_spend from vouchers where user_id = '<MemberA uuid>' order by created_at desc limit 1;` → `rm_off / active / 500 / 1100`.

---

## SECTION 5 — Redeem the RM-off voucher at checkout

### [ ] 5.1 Ineligible below min spend
- **Steps:** As Member A, add drinks totalling **under RM11**. Go to checkout, open the voucher picker.
- **Expect:** The RM5-off voucher is shown **disabled** with a "Spend more" hint. It can't be selected.

### [ ] 5.2 Eligible at/above min spend — the RM11→RM6 case
- **Steps:** Adjust cart so the subtotal is **exactly RM11** (e.g. one RM11 drink). Select the RM5-off voucher.
- **Expect:** A "Voucher −RM5.00" row appears; the grand total (both the totals row **and** the place-order button) shows **RM6.00**.

### [ ] 5.3 Toggle off
- **Steps:** Click the selected voucher again to deselect.
- **Expect:** Discount row disappears; total returns to RM11.00.

### [ ] 5.4 Place with voucher applied
- **Steps:** Re-select the voucher, place the order. Note the order number.
- **Expect:** Order places at the **discounted** total. On `/rewards`, the voucher moves out of "active" (now redeemed/dimmed).
- **SQL check (optional):** `select status, redeemed_order_id, total from vouchers v join orders o on o.id = v.redeemed_order_id where v.user_id='<MemberA uuid>' order by v.updated_at desc limit 1;` → voucher `redeemed`, order `total` = subtotal − 500.

### [ ] 5.5 Voucher can't be reused
- **Steps:** Go back to checkout with a new cart.
- **Expect:** The redeemed voucher is **no longer** in the picker.

---

## SECTION 6 — Promotion + voucher interaction (the Critical-fix check)

### [ ] 6.1 Promo order with NO voucher charges the promo price
- **Setup:** In `/admin/promotions`, create/enable a percent-off promo on a product (e.g. 20% off a RM10 drink → RM8). Have another active voucher for Member A, or skip the voucher part.
- **Steps:** As Member A, add the promo'd drink. At checkout, note the displayed total (should be the **discounted promo price**, e.g. RM8). Place the order **without** selecting a voucher. 
- **Expect:** The placed/stored total equals the **promo price shown** (RM8) — NOT the pre-promo price (RM10). This is the bug the final review caught; confirm you are charged what you saw.
- **SQL check (recommended):** `select subtotal, total from orders where order_number='<NUMBER>';` → `total` = promo price, `subtotal` = pre-promo.

### [ ] 6.2 Promo + voucher stack sensibly
- **Steps:** Same promo'd cart, but this time also apply an RM-off voucher (ensure the promo'd subtotal still meets min spend). 
- **Expect:** Displayed total = promo price − voucher amount, and the placed total matches exactly. No overcharge, no negative.

---

## SECTION 7 — Milestone at 8 (free-drink voucher + reset)

### [ ] 7.1 Reach 8 stamps
- **Steps:** Keep placing + completing paid orders until the count reaches **8**.
- **Expect:** At 8: celebration; a **free-drink voucher** ("up to RM12") appears in My Vouchers; the card **resets to 0** and the header shows the next cycle ("Card #2").
- **SQL check (optional):** `select current_count, cycle from stamp_cards where user_id='<MemberA uuid>';` → `current_count` reset, `cycle` incremented.

### [ ] 7.2 Free-drink voucher — pays the excess
- **Steps:** Add a drink **cheaper than RM12** (e.g. RM10), apply the free-drink voucher.
- **Expect:** Total goes to **RM0.00** (discount capped at the drink price).
- **Steps:** Now a drink **dearer than RM12** (e.g. RM13), apply it.
- **Expect:** Total = **RM1.00** (RM13 − RM12 cap). Customer pays the excess.

---

## SECTION 8 — In-store attach on /manage (walk-in / staff scan)

### [ ] 8.1 Attach by keyed-in phone/email, order NOT yet completed
- **Setup:** Place a **guest** order (either the kiosk without a member, or any order with no member attached). Admin opens it in `/manage`.
- **Steps:** In the order view, find "Attach member for stamp". Key in Member A's **phone or email**, click Attach.
- **Expect:** Confirmation shows Member A's display name + masked phone (`••••xxx`) — **not** their full email/phone. No stamp yet (order not completed).

### [ ] 8.2 Complete → stamp lands for the attached member
- **Steps:** Complete that order.
- **Expect:** Member A's stamp count rises by 1.

### [ ] 8.3 Attach by QR scan
- **Setup:** On a second device/phone, open Member A's `/rewards` → "Show my code".
- **Steps:** In `/manage` on a guest order, use "Scan member QR", point the camera at the code.
- **Expect:** Camera opens, scan resolves, member attaches (same confirmation as 8.1). Cancel button stops the camera.

### [ ] 8.4 Retroactive attach (already completed)
- **Steps:** Take an **already-completed** guest order (has a paid drink, no member). Attach Member A.
- **Expect:** Stamp is granted **immediately** on attach (retroactive), count +1.

### [ ] 8.5 Refuse a different member
- **Steps:** On an order already attached to Member A, try attaching a **different** member.
- **Expect:** Refused with "This order already has a different member."

---

## SECTION 9 — Kiosk add-member (`/store`)

### [ ] 9.1 Place a kiosk order + add member
- **Setup:** Open `/store` with the store passcode.
- **Steps:** Build a cart with a paid drink, place the order. On the confirmation screen ("Order placed / <number>"), find "Add member for a stamp". Key in Member A's phone/email, tap "Add stamp".
- **Expect:** "Stamp added for <name>." The confirmation does **not** auto-reset while you're typing.

### [ ] 9.2 Complete the kiosk order → stamp confirmed
- **Steps:** Admin completes that kiosk order in `/manage`.
- **Expect:** Member A's count +1. (If you attached in 9.1 before completion, completion grants it; if the order was already completed, the attach granted it retroactively.)

### [ ] 9.3 Auto-reset resumes
- **Steps:** After a successful add (or if you don't touch the field), wait.
- **Expect:** Kiosk returns to `/store` menu for the next customer (doesn't get stuck).

### [ ] 9.4 Skip = guest order
- **Steps:** Place another kiosk order, **don't** add a member.
- **Expect:** No error; order is a normal guest order with no stamp. (Acceptable.)

---

## SECTION 10 — Reversal on cancel

### [ ] 10.1 Cancel reverses the stamp
- **Setup:** Note Member A's current count. Place + complete a paid order (count +1). Note the new count.
- **Steps:** Admin cancels that order in `/manage`.
- **Expect:** Count drops back by 1.
- **SQL check (optional):** `select amount, is_reversal from stamp_transactions where order_id='<id>' order by created_at;` → a `+1` then a `-1 is_reversal=true`.

### [ ] 10.2 Cancel revokes an unredeemed milestone voucher
- **Setup:** Find an order that **issued** a voucher (the one that hit 4 or 8), where that voucher is **still active** (not yet redeemed).
- **Steps:** Cancel that order.
- **Expect:** The voucher's status becomes **expired/revoked** — it disappears from active vouchers on `/rewards`.

### [ ] 10.3 Cancel does NOT claw back an already-redeemed voucher
- **Steps:** Take an order whose milestone voucher was **already redeemed** (used on a later order). Cancel the original issuing order.
- **Expect:** The redeemed voucher stays redeemed (not resurrected, not deleted). No crash.

---

## SECTION 11 — Program disabled (gating)

### [ ] 11.1 Turn the program OFF
- **Steps:** Admin `/admin/promotions` → toggle "Program enabled" OFF → Save.

### [ ] 11.2 Customer surfaces hide
- **Steps:** Reload Member A's `/rewards`.
- **Expect:** Stamp card + member QR + voucher list are **gone**. The rest of the rewards screen (Beans, streak) still shows.

### [ ] 11.3 No new stamps while off
- **Steps:** Place + complete a paid order for Member A.
- **Expect:** Count does **not** increase.

### [ ] 11.4 Existing vouchers still redeemable
- **Steps:** If Member A has an active voucher from before, check checkout.
- **Expect:** Per design, disabling stops *new* stamps but does **not** confiscate already-earned vouchers. (Note: the checkout picker only fetches vouchers when the program is enabled — so with the program OFF the picker won't show them. If you want to redeem, turn the program back ON.)

### [ ] 11.5 Turn it back ON
- **Steps:** Re-enable + Save. Confirm the stamp card reappears on `/rewards`.

---

## Done

If every box is ticked, the loyalty stamp + voucher system works end to end. Note anything that failed with the section number and I'll dig in.

### Quick reset helpers (SQL, optional — for re-running tests)
Replace `<uuid>` with Member A's user id (`select id from auth.users where email = '...'`).
- Wipe a member's stamps + vouchers to start clean:
  `delete from stamp_transactions where user_id='<uuid>'; delete from vouchers where user_id='<uuid>'; update stamp_cards set current_count=0, cycle=0, total_stamps=0 where user_id='<uuid>';`
