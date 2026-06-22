# Menu: category sections, scroll-spy tabs, best-seller strip

Date: 2026-06-22
Surface: customer storefront + kiosk (`/menu`, shared `MenuBrowser`)

## Problem

The menu currently shows a flat list controlled by a category filter that
includes an "All" tab. Selecting a tab swaps the list to that single category.
There are no section headings, no way to see the whole menu as organized
sections, and the unused `BestSellerCarousel` means best sellers are not
surfaced anywhere.

## Goal

Turn the menu into a single continuously-scrolling page organized into category
sections, with a scroll-spy tab bar and a best-seller strip on top. Remove the
"All" tab.

## Design

### Layout

One scrolling page (no more filter-swap):

```
┌─ sticky ─────────────────────────────┐
│ ‹  MENU                                │
│ [ 🔍 Search drinks... ]                │
│ [ Coffee ] [ Non Coffee ] [ Matcha ]  │  ← scroll-spy tabs, categories only
├───────────────────────────────────────┤
│ BEST SELLER                            │  ← featured strip (best sellers, any category)
│  [img] Spanish Latte           (+)     │
│  [img] Matcha Latte            (+)     │
│ Sort by                 [Recommended▾] │
│ COFFEE                                 │  ← section heading (scroll anchor)
│  ...coffee drinks...                   │
│ NON COFFEE                             │
│  ...non-coffee drinks...               │
│ MATCHA                                 │
│  ...matcha drinks...                   │
└───────────────────────────────────────┘
```

- Tabs list **categories only** — no "All", no "Best Seller" tab.
- Best sellers are duplicated: featured at the top **and** still shown inside
  their own category section.
- A category with zero products renders **neither** a section nor a tab.
- The best-seller strip and each section reuse the existing `MenuCard` row
  (same component, same sold-out / sale / badge treatment). No new card style.
- Section heading style matches the existing "Best Seller" heading:
  `text-xs font-bold uppercase tracking-wide`.

### Scroll-spy + tap-to-scroll

- As the user scrolls, the tab for the section under the sticky header
  highlights automatically, driven by an `IntersectionObserver` with a trigger
  line just below the sticky header (`rootMargin` top = measured sticky height,
  bottom = large negative so only the topmost in-band section is active).
- The sticky header height is measured at runtime (ref + `ResizeObserver` or a
  layout effect) and used for:
  - the observer's top `rootMargin`, and
  - each section's `scroll-margin-top` (dynamic value → inline `style` is
    acceptable per the styling rules, since it is computed at runtime).
- Tapping a tab smooth-scrolls to that section's heading and activates the tab
  immediately (briefly ignoring observer updates to avoid flicker is optional;
  keep it simple first).
- At the very top (best-seller area, above the first section), the **first**
  category tab stays active — no dead/unselected state.

### Ordering

A pure helper `sortProducts(items, sort)` in `lib/menu/sorting.ts`:

- `"recommended"` (default): `isNew` first → then `isBestSeller` → then the
  rest, each group ordered by **price low→high** (`getBasePrice`).
- `"price-asc"` / `"price-desc"`: pure price sort, ignoring the new/best-seller
  priority.

Applied identically to the best-seller strip and to each category section.
The dropdown's "Popular" option is renamed **"Recommended"**; `"price-asc"` and
`"price-desc"` stay.

Best sellers in the strip are those with `isBestSeller === true` (sold-out
included, shown greyed by `MenuCard`, consistent with sections). They are
ordered by the same `sortProducts` helper.

### Search mode

When the search box is non-empty:

- Hide the tabs, the best-seller strip, and all section headings.
- Show one flat list of matching drinks (name/description match, current
  behavior), ordered by the active sort.
- "No drinks match your search." when empty.
- Clearing search restores the sectioned view.

The "Sort by" control stays visible in both modes.

## Files

- `components/menu-browser.tsx` — rework into the sectioned / scroll-spy layout
  (primary change). Holds search + sort state, builds the best-seller list and
  per-category sections, renders sticky header + tabs + strip + sections, wires
  the scroll-spy hook.
- `components/category-tabs.tsx` — drop the "All" tab; props become the category
  list, the active category type, and a select handler that scrolls. Keep the
  existing pill styling.
- `hooks/use-scroll-spy.ts` — **new**. Given an ordered list of section ids and
  an offset, returns the active id and a `scrollTo(id)` function.
- `lib/menu/sorting.ts` — **new**. The `sortProducts` pure helper.

The orphaned `components/best-seller-carousel.tsx` stays in place, unused (not
deleted as part of this work).

## Out of scope

- No data/schema/RLS changes — `isNew` / `isBestSeller` already exist on
  `Product`.
- Not deleting or repurposing `best-seller-carousel.tsx`.
- No changes to product detail, cart, or checkout.
