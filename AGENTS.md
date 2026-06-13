You are an expert Next.js and Supabase engineer helping me build NAISE COFFEE.
Write clean, simple, maintainable code. Prioritize clarity over unnecessary abstraction.
Think like a senior full-stack web developer.

---

## Project Overview

We are building NAISE COFFEE, a website for ordering coffee that uses wa.me (WhatsApp) direct links for placing orders, sharing status, and keeping the flow systematic.

The app has three surfaces:

- A customer-facing storefront (browse, customize, cart, checkout via WhatsApp, rewards).
- An admin/manager CMS (menu, orders, customers, reports, role-based access).
- A system layer (auth, RLS, realtime, storage, PWA, SEO).

Keep the implementation simple and readable.

---

## Tech Stack

- Next.js (App Router)
- TypeScript
- Tailwind CSS
- shadcn/ui
- Supabase (authentication, Postgres database, storage, realtime, Row Level Security)
- next-pwa (or equivalent) for installable PWA support

Do not introduce new major libraries unless there is a strong reason. Ask before installing anything new.

---

## Development Philosophy

Build feature by feature.
For every feature:

1. Read this file first.
2. Keep the implementation simple.
3. Avoid overengineering.
4. Prefer readable code over clever code.
5. Build the smallest useful version first.
6. Refactor only when repetition appears.

---

## Decision Making

If something is unclear or could be improved, suggest a better approach. If a new library would significantly help, recommend it, explain why, and ask before adding it.
Do not install new libraries without approval.

---

## Architecture

Use this folder structure:

```
app/
  (customer)/        # customer-facing routes (menu, product, cart, checkout, profile, rewards)
  (admin)/           # admin/manager CMS routes (dashboard, menu mgmt, orders, customers, reports)
  (auth)/            # sign in, sign up, callback
  api/               # route handlers (server-side only logic, webhooks)
components/
  ui/                # shadcn/ui primitives
constants/
data/
hooks/
lib/
  supabase/          # supabase server/client/middleware helpers
store/
types/
public/
supabase/
  migrations/        # SQL migrations
```

**app/** is for routes, layouts, and pages only. Use Server Components by default; add `"use client"` only when a component needs interactivity, state, or browser APIs. Pages compose components and call server actions, route handlers, or stores. They should not contain large reusable UI blocks or heavy business logic.
**components/** is for reusable UI. Create a component when it is reused in multiple places, when it makes a page easier to read, or when it represents a clear UI concept. Examples for this app: MenuCard, CategoryTabs, ProductCustomizer, CartSheet, OrderStatusBadge, BeansBalance, AdminDataTable. Do not create components too early.
**components/ui/** holds shadcn/ui components. Add them with the shadcn CLI rather than hand-writing them.
**data/** holds hardcoded/seed content. Keep it typed.
**store/** holds client state stores (e.g. cart). Keep server state in the database and fetch it on the server; only put genuinely client-side state here.
**lib/** holds external service helpers. **lib/supabase/** must expose separate clients: a browser client, a server client (for Server Components/actions using cookies), and middleware helpers. Never expose the service-role key to the client.
**supabase/migrations/** holds versioned SQL. Schema changes go through migrations, not ad-hoc edits.

---

## Database Design

You are responsible for designing and maintaining the database.

- Use Postgres via Supabase. Model the schema before writing feature code.
- Core tables to expect: `profiles` (linked to `auth.users`), `categories`, `products`, `product_variants` (size/price), `addons`, `category_addons`, `orders`, `order_items`, `order_item_addons`, `rewards`, `reward_redemptions`, `bean_transactions`, `promotions`, `referrals`, `daily_streaks`. Adjust as features require.
- Use UUID primary keys, `created_at`/`updated_at` timestamps, and foreign keys with sensible `on delete` behavior.
- Use enums (or check constraints) for fixed sets: order status (`pending`, `preparing`, `ready`, `completed`, `cancelled`), roles (`admin`, `manager`, `staff`, `customer`), category type (`coffee`, `non_coffee`, `matcha`).
- Add indexes on foreign keys and on columns used for filtering/search.
- Store money as integers in the smallest currency unit (or `numeric`), never floats.
- Every change ships as a migration in `supabase/migrations/`. Provide reversible, reviewable SQL.

### Row Level Security (RLS)

- Enable RLS on every table that holds user or business data.
- Customers can read public catalog data (products, categories, addons, promotions) and read/write only their own rows (orders, profile, beans, redemptions).
- Admin/manager/staff access is gated by role via policies that check the user's role from `profiles`.
- Never rely on client-side checks for security. Enforce in RLS and server code.
- Write policies alongside the migration that creates the table.

---

## UI Rules

For any UI task:

- Replicate the provided design exactly.
- Match layout, spacing, padding, font sizes, font hierarchy, colors, border radius, shadows, alignment, and proportions.
- Do not approximate. Do not simplify unless explicitly asked.
- Mobile-first. Design for small screens, then scale up with responsive breakpoints.

---

## Styling Rules

Use Tailwind CSS utility classes. Do not write separate CSS files or CSS modules unless a utility approach genuinely cannot express the style.
Use shadcn/ui components as the base for common UI (buttons, dialogs, sheets, inputs, tables, dropdowns) and style them with Tailwind. Do not rebuild primitives that shadcn already provides.
Use the `cn()` helper (from `lib/utils`) to merge conditional classes. Reuse repeated class patterns by extracting a component or a shared constant, not by copy-pasting.
Keep design tokens (colors, radius, fonts) in the Tailwind config and shadcn theme, not scattered as magic values.

### Style Exception List

It is acceptable to step outside plain Tailwind utility classes for:

- Complex keyframe animations not expressible with Tailwind utilities (define in `globals.css` or Tailwind config).
- Dynamic values computed at runtime (e.g. a width from a percentage) — use inline `style` only for the dynamic part, Tailwind for the rest.
- Third-party components that require their own styling API.
- Global resets, font-face declarations, and CSS variables in `globals.css`.
- Arbitrary one-off values where no token fits — use Tailwind arbitrary values (`w-[37px]`) rather than a new CSS file.

Everywhere else, use Tailwind utilities.

---

## Image Rule

Use the Next.js `<Image>` component for all images (it handles optimization, sizing, and lazy loading). Plain `<img>` is only acceptable when `<Image>` cannot work (e.g. some inline SVG cases).

- Static assets live in `public/` and are referenced by path, or imported for local assets.
- Centralize repeated image references in `constants/images.ts` so paths are not duplicated across files.
- Product images uploaded by admins live in Supabase Storage. Reference them by their storage URL, set `next.config` `images.remotePatterns` to allow the Supabase domain, and pass `width`/`height` (or `fill` with a sized parent).
- Always provide meaningful `alt` text.

```ts
export const images = {
  logo: "/logo.png",
  mascot: "/mascot.png",
};
```

```tsx
import Image from "next/image";
import { images } from "@/constants/images";

<Image src={images.logo} alt="Naise Coffee" width={120} height={40} />;
```

---

## PWA

The app must be installable.

- Provide a web app manifest (`app/manifest.ts` or `public/manifest.json`) with name, short_name, icons (192/512), theme/background color, `display: "standalone"`, and start_url.
- Provide a service worker (via next-pwa or equivalent) for offline shell and caching of static assets and catalog data. Do not aggressively cache authenticated or order data.
- Provide all required icons and an apple-touch-icon.
- Push notifications are a future feature — scaffold the manifest/service worker so they can be added later, but do not build push now unless asked.

---

## State Management

- Server state (menu, orders, customers) lives in Supabase and is fetched on the server in Server Components or route handlers. Prefer fetching where the data is used.
- Client state stores (in `store/`) are only for genuinely client-side state such as the cart and UI preferences. Persist the cart to localStorage when it should survive reloads.
- Local component state for temporary UI state.
- Use realtime subscriptions for live order status updates in the admin order board and customer order tracking.

---

## TypeScript

- Strict mode.
- No `any`.
- Generate and use Supabase types for database rows (`supabase gen types`). Keep them in `types/`.
- Keep types simple and readable.

---

## Feature Implementation

When building a feature:

1. Read this file first.
2. Design or update the database schema and RLS if the feature touches data.
3. Identify the files to change.
4. Keep changes focused.
5. Do not rewrite unrelated code.
6. Follow existing patterns.
7. Make sure the feature works end to end.
8. Fix lint and type errors before finishing.

---

## Secrets

- Never expose secret keys in client code.
- Only the Supabase URL and anon key may reach the client (via `NEXT_PUBLIC_` env vars). The service-role key is server-only and must never be imported into client components.
- Use route handlers or server actions for privileged operations, tokens, and any external API access.

---

## Authentication

- Use Supabase Auth. Do not build custom auth.
- Use the SSR cookie-based session flow with the App Router (server client + middleware to refresh sessions).
- Gate admin/manager/staff routes by role, checked on the server, and back it with RLS.

---

## SEO

- The customer storefront must be SEO optimized.
- Use Next.js metadata APIs (`metadata` / `generateMetadata`) for titles, descriptions, and Open Graph tags.
- Use semantic HTML and proper heading hierarchy.
- Keep public catalog pages server-rendered so they are crawlable.

---

## WhatsApp Ordering

- Orders are placed via wa.me direct links. Build the order summary (items, customizations, totals, order reference) into a pre-filled WhatsApp message.
- URL-encode the message body. Keep the message format readable and systematic so status/handoff is consistent.
- Persist the order in the database before/at handoff so it is tracked in the system, not only in WhatsApp.

---

## Feature List

### Customer App Features

- Browse menu by category (Coffee, Non Coffee, Matcha)
- Search menu items
- View product details
- Product customization
  - Size selection
  - Ice level
  - Sugar level
  - Add-ons based on category
- Add to cart
- Cart management
- Checkout
- Order history
- Rewards system (Beans)
- Reward redemption
- User profile management
- QR menu access
- Installable PWA experience
- Push notifications (future)
- WhatsApp order support
- Promotions and featured items
- Best Seller section
- New Item badges
- Referral program
- Daily streak rewards

### Admin / Manager CMS Features

- Dashboard overview
  - Total orders
  - Revenue
  - Best sellers
  - Active customers
- Menu management
  - Create menu item
  - Edit menu item
  - Archive menu item
  - Manage pricing
  - Upload product images
- Category management
  - Coffee
  - Non Coffee
  - Matcha
- Add-on management
  - Coffee add-ons
  - Non Coffee add-ons
  - Matcha add-ons
- Inventory availability toggle
- Featured item management
- Promotion management
- Rewards management
  - Create rewards
  - Edit bean requirements
- Customer management
- Order management
  - Pending
  - Preparing
  - Ready
  - Completed
  - Cancelled
- Reports and analytics
- Role-based access
  - Admin
  - Manager
  - Staff

### System Features

- Authentication
- Role-based permissions
- Mobile-first responsive design
- Dark and light support (future)
- Supabase authentication
- Supabase storage
- Real-time updates
- Secure database with Row Level Security
- PWA support
- SEO optimized website

---

## Communication

Be concise. Explain what changed and how to test it.

---

## Final Reminder

Before every feature:

- Read this file.
- Follow it strictly.
- Design the database and RLS before coding data features.
- Build clean, simple code.
- Replicate UI exactly when designs are provided.


---

## Next.js Version Note

<!-- BEGIN:nextjs-agent-rules -->
This installed Next.js version may have breaking changes vs. older knowledge. Read the relevant guide in `node_modules/next/dist/docs/` before writing Next.js code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
