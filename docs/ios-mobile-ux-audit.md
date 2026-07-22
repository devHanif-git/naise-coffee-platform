# iOS Mobile UX/UI Audit — NAISE COFFEE

**Tarikh / Date:** 2026-07-22
**Skop / Scope:** Customer storefront (utama) + Admin CMS. Fokus iOS Safari + PWA (installed).
**Status:** Penemuan sahaja / Findings only — belum ubah apa-apa kod / no code changed yet.

> **Nota penting / Important note:** Checkout **bukan** guna WhatsApp lagi. Order simpan ke Supabase → bayar guna CHIP / cash / bank transfer, notifikasi staff guna Telegram. `wa.me` cuma tinggal untuk mesej "order ready" staff (`lib/orders/message.ts:109`). Dokumentasi projek dah lapuk pasal ni.
> _Checkout no longer uses WhatsApp. Orders persist to Supabase then pay via CHIP / cash / bank transfer; staff notified via Telegram. The only `wa.me` link left is the staff "order ready" message._

---

## Ringkasan Keutamaan / Priority Summary

| Prio | Perkara / Item | Effort | Fail utama / Key file |
|------|----------------|--------|------------------------|
| 🔑 **KEYSTONE** | `viewport-fit=cover` tak set → semua safe-area jadi mati | S | `app/layout.tsx` |
| **P1** | Betulkan body scroll-lock hook (iOS bocor) | M | `hooks/use-body-scroll-lock.ts` |
| **P1** | Semua modal guna hook yang sama | M | ~11 fail modal |
| **P1** | `vh` → `dvh` (4 sheet tinggal) | S | `drink-row.tsx` dll |
| **P1** | `overscroll-contain` kat sheet/modal | S | `cart-sheet.tsx` |
| **P1** | Tap target naik ke 44px | S/M | `cart-sheet.tsx`, `checkout-screen.tsx` dll |
| **P1** | Validate cart lepas `JSON.parse` | S | `store/cart.tsx` |
| **P2** | CHIP payment mungkin balik Safari bukan PWA | M | `payment-review.tsx` |
| **P2** | Cart dialog tak trap focus (VoiceOver) | M | `cart-sheet.tsx` |
| **P3** | Payment poller berhenti lepas 120s | S | `payment-waiting-poller.tsx` |
| **P3** | Butang back checkout label salah | S | `checkout-screen.tsx` |
| **P3** | Checkout catch telan error | S | `checkout-screen.tsx` |
| **P4** | Recipe drag tak sampai row luar skrin | M | `recipe-builder.tsx` |
| **P4** | Butang up/down recipe ~20px | S | `recipe-builder.tsx` |
| **P5** | Self-host font (Satoshi, Cabinet Grotesk) | M | `app/globals.css` |
| **P5** | Tap-highlight / touch-callout iOS | S | `app/globals.css` |
| **P5** | Splash image iOS + status bar style | M/S | `app/layout.tsx` |

**S** = kecil/senang (small), **M** = sederhana (medium), **L** = besar (large).

---

## 🔑 KEYSTONE — Buat Dulu / Do This First

### `viewport-fit=cover` tak diset — semua safe-area jadi kod mati

**EN:** There's no `export const viewport` with `viewportFit: "cover"` in the root layout, so **every** `env(safe-area-inset-*)` in the app resolves to `0`. The tab bar, cart FAB, product CTA, sheets, and admin save bars all *try* to respect the notch/home-indicator but currently can't.

**BM:** Root layout tak ada `viewport` dengan `viewportFit: "cover"`. Sebab tu, **semua** `env(safe-area-inset-*)` dalam app jadi `0`. Tab bar, cart FAB, butang CTA produk, sheet, dan save bar admin semua dah *cuba* elak kawasan notch/home-indicator, tapi tak jalan sebab setting ni tak ada.

**Kenapa penting / Why it matters:** Fix satu benda ni, banyak "bug" safe-area lain terus selesai. Ini punca akar. / Fix this one thing and a pile of safe-area "bugs" resolve at once. This is the root cause.

**Fail / File:** `app/layout.tsx` (tiada viewport config di ~L35-48)
**Effort:** S

**Contoh / Example:**
```tsx
// TAMBAH kat app/layout.tsx / ADD to app/layout.tsx
import type { Viewport } from "next";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",   // <-- ini yang hidupkan env(safe-area-inset-*)
  themeColor: "#RRGGBB",  // ganti dgn warna brand / use brand color
};
```

---

## P1 — Menang Cepat / Quick Wins

### 1. Body scroll-lock hook bocor kat iOS

**EN:** The hook only sets `document.body.style.overflow = "hidden"`, which iOS Safari ignores — the page keeps rubber-banding behind the modal.
**BM:** Hook cuma set `overflow: hidden`, tapi iOS Safari tak endah — page tetap boleh scroll/rubber-band belakang modal.

**Fail / File:** `hooks/use-body-scroll-lock.ts:15`  · **Effort:** M

```ts
// SEBELUM / BEFORE — iOS tak hormat ni
document.body.style.overflow = "hidden";

// SELEPAS / AFTER — kunci guna position:fixed + ingat scroll position
const scrollY = window.scrollY;
document.body.style.position = "fixed";
document.body.style.top = `-${scrollY}px`;
document.body.style.width = "100%";

// bila modal tutup / on release:
document.body.style.position = "";
document.body.style.top = "";
window.scrollTo(0, scrollY);   // balik ke tempat asal
```

### 2. Semua modal kena guna hook yang sama

**EN:** ~11 modals still poke `document.body.style.overflow` directly. These don't compose — open two and you can get permanently stuck unscrollable. This is exactly the bug your recent refcount commit was fighting.
**BM:** ~11 modal masih ubah `document.body.style.overflow` sendiri-sendiri. Ni tak compose — buka dua modal, boleh jadi skrin tersangkut tak boleh scroll terus. Ni la bug yang commit refcount kau baru-baru ni lawan.

**Fail / Files:** `cart-sheet.tsx:186`, `avatar-crop-modal.tsx:65`, `change-payment-modal.tsx:33`, `order-complete-modal.tsx:41`, `refund-passcode-modal.tsx:32`, `phone-prompt-sheet.tsx:33` (+ order-finished, receipt, rewards-info, rewards-referral, rewards-tiers, sign-out)  · **Effort:** M

```tsx
// SEBELUM / BEFORE — tiap modal buat sendiri
useEffect(() => {
  document.body.style.overflow = "hidden";
  return () => { document.body.style.overflow = ""; };
}, [open]);

// SELEPAS / AFTER — satu hook je, refcount jaga stacking
useBodyScrollLock(open);
```

### 3. `vh` → `dvh` (4 sheet tinggal)

**EN:** These sheets still use `vh`, which on iOS includes space behind the address bar → sheet melompat/terlebih tinggi bila toolbar Safari berubah. Most of the app already uses `dvh` correctly.
**BM:** Sheet ni masih guna `vh`. Kat iOS, `vh` kira ruang belakang address bar → sheet jadi terlebih tinggi / melompat bila toolbar Safari naik-turun. Selebihnya app dah guna `dvh` betul.

**Fail / Files:** `drink-row.tsx:307`, `rewards-tiers-modal.tsx:49`, `stamps/voucher-picker-sheet.tsx:60`, `swap-picker.tsx:147`  · **Effort:** S

```tsx
// SEBELUM: max-h-[85vh]
// SELEPAS: max-h-[85dvh]
```

### 4. `overscroll-contain` kat scroller sheet/modal

**EN:** Inner scroll regions lack `overscroll-behavior`, so momentum bleeds into the page at the top/bottom (classic iOS rubber-band leak).
**BM:** Kawasan scroll dalam sheet tak ada `overscroll-behavior`, jadi momentum "bocor" ke page bila sampai atas/bawah (rubber-band iOS yang menyampah tu).

**Fail / File:** `cart-sheet.tsx:262`  · **Effort:** S

```tsx
// SEBELUM: className="overflow-y-auto"
// SELEPAS: className="overflow-y-auto overscroll-contain"
```

### 5. Tap target naik ke 44px

**EN:** Frequently-tapped controls are only 28-36px — below Apple's 44×44pt minimum. Easy to mis-tap one-handed. Keep the icon small; just enlarge the hit box.
**BM:** Butang yang selalu ditekan cuma 28-36px — bawah minimum Apple 44×44pt. Senang tersalah tekan guna satu tangan. Icon boleh kekal kecil, cuma besarkan kotak sentuh je.

**Fail / Files:** cart qty/remove `cart-sheet.tsx:124,131,141` · sheet close `ui/sheet.tsx:76` · checkout back `checkout-screen.tsx:300` · voucher actions `checkout-screen.tsx:625-638` · category pills `category-tabs.tsx:44,61` · sort `menu-browser.tsx:228`  · **Effort:** S/M

```tsx
// SEBELUM / BEFORE — ~28px
<button className="p-1"><Minus className="size-4" /></button>

// SELEPAS / AFTER — 44px kotak sentuh, icon sama saiz
<button className="flex min-h-11 min-w-11 items-center justify-center p-1">
  <Minus className="size-4" />
</button>
```

### 6. Validate cart lepas `JSON.parse`

**EN:** Persisted cart is cast straight to `CartItem[]`. A stale schema or corrupt entry survives the `items.length` check but produces `NaN` totals. (Server reprices safely, but the UI cart breaks.)
**BM:** Cart dari localStorage terus di-cast jadi `CartItem[]`. Kalau ada entry lapuk/rosak, dia lepas check `items.length` tapi buat total jadi `NaN`. (Server kira harga semula dengan selamat, tapi cart kat UI rosak.)

**Fail / File:** `store/cart.tsx:121-132`  · **Effort:** S

```ts
// SEBELUM / BEFORE
const items = JSON.parse(raw) as CartItem[];

// SELEPAS / AFTER — buang line rosak masa hydrate
const parsed = JSON.parse(raw);
const items = Array.isArray(parsed) ? parsed.filter(isValidCartItem) : [];

function isValidCartItem(x: unknown): x is CartItem {
  return !!x && typeof x === "object"
    && typeof (x as any).id === "string"
    && Number.isInteger((x as any).price)
    && Number.isInteger((x as any).quantity) && (x as any).quantity > 0;
}
```

---

## P2 — Bug Ketepatan iOS / iOS Correctness

### 7. CHIP payment mungkin balik ke Safari, bukan PWA

**EN:** Payment does a top-level external navigation to CHIP. iOS often breaks standalone → external → back, so the success redirect can land in plain Safari — splitting the user from the installed app. Data side is safe (server reconciles by token), it's the *context* that breaks.
**BM:** Payment buat navigation keluar ke CHIP guna top-level nav. iOS selalu pecah standalone → keluar → balik, jadi redirect "berjaya" boleh mendarat kat Safari biasa — user terpisah dari app yang di-install. Data selamat (server reconcile guna token), yang rosak cuma *context* app.

**Fail / File:** `payment-review.tsx:49`  · **Effort:** M
**Fix:** Tambah butang jelas "Return to NAISE COFFEE" kat page dah bayar. / Add a clear "Return to NAISE COFFEE" affordance on the paid page.

### 8. Cart dialog tak trap focus (VoiceOver)

**EN:** The custom portal sets `role="dialog"` + `aria-modal` but never moves focus in, traps it, or restores it. VoiceOver / keyboard users can wander into the dimmed background.
**BM:** Portal custom ni set `role="dialog"` + `aria-modal` tapi tak pindah focus masuk, tak trap, tak restore. User VoiceOver / keyboard boleh tersasar masuk ke background yang dah gelap.

**Fail / File:** `cart-sheet.tsx:206-212`  · **Effort:** M
**Fix:** Guna balik Radix `Sheet` primitive yang dah ada (`components/ui/sheet.tsx`). / Reuse the existing Radix Sheet primitive.

---

## P3 — Aliran / UX & Flow

### 9. Payment poller berhenti lepas 120s
**EN:** Auto-refresh ends after 120s; a slow bank / 2FA / app-switch leaves a stale waiting screen even after payment succeeds.
**BM:** Auto-refresh mati lepas 120s; bank lambat / 2FA / tukar app boleh tinggal skrin "waiting" lapuk walaupun bayaran dah berjaya.
**Fail:** `payment-waiting-poller.tsx:12-31` · **Fix:** Refresh bila `visibilitychange` (user balik ke app). · **Effort:** S

### 10. Butang back checkout — label tak padan
**EN:** Label says "Go back to cart" but the action pushes `/menu`. Confusing, especially for VoiceOver.
**BM:** Label kata "Go back to cart" tapi sebenarnya pergi `/menu`. Mengelirukan, lagi-lagi untuk VoiceOver.
**Fail:** `checkout-screen.tsx:298-300` · **Fix:** Betulkan label jadi "Back to menu", atau ubah action balik ke cart. · **Effort:** S

### 11. Checkout catch telan error
**EN:** The generic catch discards the exception → can't tell an offline-during-app-switch from a real rejection.
**BM:** Catch generik buang exception → tak boleh beza antara "offline masa tukar app" dengan order betul-betul ditolak.
**Fail:** `checkout-screen.tsx:282` · **Fix:** Log exception, kekalkan mesej selamat untuk user. · **Effort:** S

---

## P4 — Admin CMS (Mobile)

### 12. Recipe drag reorder tak sampai row luar skrin
**EN:** Custom pointer-drag has no `setPointerCapture` (a stray touch/scroll silently drops the drag) and no edge auto-scroll (can't drop onto a row that isn't currently visible). Compounded by #13 being the touch fallback.
**BM:** Drag custom tak ada `setPointerCapture` (sentuhan/scroll tersasar boleh lepaskan drag senyap-senyap) dan tak ada auto-scroll tepi (tak boleh letak kat row yang tak nampak sekarang). Jadi lagi teruk sebab #13 (butang) pun kecil.
**Fail:** `recipe-builder.tsx:187-230` · **Fix:** `setPointerCapture` masa pointerdown + auto-scroll bila hampir tepi. · **Effort:** M

### 13. Butang up/down recipe ~20px
**EN:** `p-0.5` around a `size-4` icon ≈ 20px — the touch alternative to the broken drag is itself hard to tap.
**BM:** `p-0.5` keliling icon `size-4` ≈ 20px — alternatif touch untuk drag yang rosak tu pun susah nak tekan.
**Fail:** `recipe-builder.tsx:494-518` · **Fix:** Besarkan hit box ke 44px, icon kekal. · **Effort:** S

> Save bar admin (`product-form.tsx:444`, `rewards-manager.tsx:358`, `cost-manager.tsx:254`) + hamburger 36px (`admin-shell.tsx:157`) — kebanyakannya selesai bila KEYSTONE dibetulkan; hamburger naikkan ke 44px. / Mostly resolved by the KEYSTONE fix; bump hamburger to 44px.

---

## P5 — Kemasan / UI Polish

### 14. Self-host font
**EN:** Satoshi + Cabinet Grotesk load via render-blocking `@import` from Fontshare → FOUT/reflow on mobile networks.
**BM:** Satoshi + Cabinet Grotesk load guna `@import` (render-blocking) dari Fontshare → teks berkelip/reflow atas rangkaian mobile.
**Fail:** `app/globals.css:1` · **Fix:** Pindah ke `next/font/local` (dapat preload + fallback metric). · **Effort:** M

### 15. Tap-highlight / touch-callout iOS
**EN:** No `-webkit-tap-highlight-color` treatment → grey flash + long-press callout on the tab bar makes the PWA feel webby.
**BM:** Tiada `-webkit-tap-highlight-color` → kelipan kelabu + callout tekan-lama kat tab bar buat PWA rasa macam website biasa.
**Fail:** `app/globals.css` (tiada rule) · **Fix:** Matikan highlight/callout kat chrome interaktif SAHAJA; kekalkan kat teks & input. · **Effort:** S

### 16. Splash image iOS + status bar style
**EN:** No `apple-touch-startup-image` (blank cold launch); status bar style is `"default"`.
**BM:** Tiada `apple-touch-startup-image` (skrin kosong masa buka mula-mula); status bar style `"default"`.
**Fail:** `app/layout.tsx:29-32` · **Fix:** Jana splash sizes + pertimbang `black-translucent`. · **Effort:** M/S

---

## ✅ Dah Bagus — Jangan Usik / Already Good

- Manifest installable + icon maskable & apple-touch (`app/manifest.ts:4-17`)
- Service worker gated production sahaja (`next.config.ts:44`, `app/sw.ts:16`)
- Kebanyakan layout dah guna `dvh` (`app/(customer)/layout.tsx:34`)
- Input 16px → tak auto-zoom kat iOS (`ui/input.tsx:11`)
- Scroll position menu di-restore lepas balik dari produk (`menu-browser.tsx:61`)
- Image reserve dimension + skeleton (`ui/smart-image.tsx:36`)
- Reduced-motion dihormati (`globals.css:265`)
- Server reprice + semak availability masa checkout (`checkout/actions.ts:106`)

---

## ❓ Tak Dapat Sahkan / Couldn't Verify (tiada device fizikal)

- Overlap home-indicator sebenar, resize toolbar, rasa rubber-band — dinilai statik dari kod je.
- Kelakuan CHIP breakout/balik antara versi iOS.
- Susunan VoiceOver, keyboard tutup input, restore focus.
- SW offline/cold-start bawah rangkaian perlahan.
- Kos Fontshare tak diukur (tiada trace LCP/CLS).

---

## Cadangan Batch Pertama / Suggested First Batch

**EN:** Do KEYSTONE + #1 + #2 + #3 + #4 together — they all touch the same iOS scroll/safe-area foundation and #1/#2 directly extend your recent refcount work. Fold in #5 (tap targets) and #6 (cart validation) since they're independent and easy. Hold CHIP-return (#7) and font self-host (#14) as follow-ups — they need device testing / a perf trace.

**BM:** Buat KEYSTONE + #1 + #2 + #3 + #4 sekali gus — semua sentuh asas scroll/safe-area iOS yang sama, dan #1/#2 sambung terus kerja refcount kau baru-baru ni. Masukkan sekali #5 (tap target) dan #6 (validate cart) sebab senang & berdiri sendiri. Tangguh CHIP-return (#7) dan self-host font (#14) jadi follow-up — kena test atas device / ambil trace perf dulu.
