# 020 · Home: a dashboard for every role

## Why

Before this, everybody landed on the billing screen after signing in, the kitchen on the kitchen display, and nobody had
one place that said "this needs you now". Home is that place: the owner sees the day's money and anything going wrong,
the manager runs the floor, the cashier sees what can be paid, the waiter sees their tables, the kitchen sees what to
cook. Every business login lands on Home.

## What each person sees

What a person sees comes from **what they may do** (their permissions), **what the business's plan includes**, and the
**kind of business** (restaurant, café, cloud kitchen or shop), never from the role's name. The role only decides the
order. Money (₹) appears only for people who can take payments or see reports, and the server checks this.

| Who | Home shows (in this order) |
|---|---|
| Owner | Today's sales (bills, average bill) · payments split* · running bills · floor now** · UPI payments to confirm · ready to pay · ready to serve · kitchen · kitchen delays** · sales by hour* · top items* · cancellations & on the house* (with ₹) · low stock · your Storant plan |
| Manager | Floor now** · running bills · ready to serve · kitchen delays** · kitchen · UPI payments to confirm · ready to pay · today's sales · cancellations & on the house* (counts only, no ₹, no names) · low stock |
| Cashier | Ready to pay · UPI payments to confirm · running bills · my collection today (cash / UPI / card) · my day |
| Waiter | My tables (cooking / ready per table) · ready to serve (mine first) · my day (counts only, **no ₹**) |
| Kitchen | Open kitchen display (big button) · voice on/off with "Tap to turn on voice" · "Start on kitchen display" for this device · new / cooking / ready counts, oldest ticket, what to cook next |
| Custom role | The list of the built-in role it is closest to: reports → like a manager, payments → cashier, orders → waiter, kitchen → kitchen. A role with almost nothing (e.g. only "see the menu") gets a welcome card with links to the screens it can open. |

\* needs the plan feature **Dashboard insights** · \*\* needs **Dashboard live monitor**.

Shops (retail) don't get tables, kitchen, ready-to-serve or UPI-claim widgets; cloud kitchens get the kitchen widgets
but no tables.

Above the widgets, an **alerts strip** shows only what needs someone now (kitchen tickets late, tables waiting too
long, food ready for your tables, UPI payments to confirm, online orders waiting, items out of stock, and for the owner
a plan that is about to end). Each alert opens its screen. Quick buttons (New bill / New order, Tables, Orders, Kitchen
display, Reports) appear for the screens the person can open. Home has no Sign out of its own: signing out stays in
Settings → Account, the phone's More screen, the desktop sidebar, and (for the kitchen) the Settings home.

### The kitchen

The new-order voice ("नया ऑर्डर आया है। टेबल 5।") works on the kitchen's Home as well as on the kitchen display, with
the same "Tap to turn on voice" prompt and the screen kept awake, so a kitchen that stays on Home never misses an order.
A ticket is announced once, even with both screens open. A kitchen tablet can switch on **Start on kitchen display**
(per device) to open the display straight after sign-in.

### Plans

The basic Home is on every plan and can't be switched off. Two plan features add more:

| Feature key | Adds | Default plans |
|---|---|---|
| `dashboard_insights` | Payments split, sales by hour, top items, cancellations & on the house | Pro |
| `dashboard_live` | Floor now (tables waiting over the amber / red minutes), kitchen delays | Standard, Pro |

The super admin turns them on or off per plan in **Plans & features** (a "Home dashboard" section under the modules) and
per business in the business page's overrides, like any other feature; an owner can also hide them in **Settings →
Modules**. When the plan lacks them, staff simply don't see those widgets; the **owner** sees one card, "More on your
Home with a higher plan", listing what's missing, with a link to the plans. Never one locked card per widget.

### Landing

- After sign-in, a cold start of the app, the PWA's start page (`/`) and the offline fallback: **Home**.
- A link opened while signed out (for example `/reports` or `/pos?table=…`) is remembered for that browser tab; after
  sign-in the person goes there if their role can open it, otherwise to Home. Signing out on purpose forgets it.
- A device with "Start on kitchen display" switched on opens the kitchen display instead (if the role can open it).
- "Home" is the first navigation item for everyone (desktop shortcut `g h`); on phones it takes one of the four
  bottom-bar places, so Kitchen moves under More for owners, cashiers and waiters.

### Offline

Home keeps the last dashboard it loaded on the device and shows it with "Offline · showing 10:42" when there is no
connection; quick buttons still work (billing works offline). Signing out clears the saved copy.

## Numbers

- "Today" is midnight to midnight, India time, exactly like Reports, and every sales number on Home comes from the same
  helpers Reports uses (`app/services/sales_window.py`): today's sales, average bill, payments split, sales by hour,
  top items and "my day". Home and Reports always agree.
- Cancellations & on the house use the same rules as the Owner's watch (bills cancelled today, items cancelled after /
  removed before the kitchen, on the house, manual discounts on bills completed today).
- "Ready to pay" uses the owner's pay rules (Settings → Kitchen rules), the same check as taking payment.
- "Floor now" and "Kitchen delays" use the amber / red minutes from the floor alert settings.
- "My collection" counts today's bills the cashier settled (by `settled_by`), split by payment method.

## Technical

### API

`GET /api/v1/dashboard` (any business login; tenant DB session with RLS). Optional `widgets=a,b` returns only those
widgets (the app refreshes live widgets on their own); unknown keys and widgets the person may not see are ignored.

```json
{
  "persona": "owner", "business_type": "restaurant", "server_time": "…Z", "day": {"from": "…Z", "to": "…Z"},
  "widgets": [{"key": "today_sales", "refresh": 60, "data": {"orders": 12, "gross_sales": 8450.0, "average_order_value": 704.17}},
              {"key": "kitchen", "refresh": 15, "error": "Couldn't load this right now."}],
  "locked": ["payment_split", "hourly_sales"]
}
```

`locked` is filled only for the owner. A widget that fails returns `error` instead of `data`; the others still load
(each widget runs in its own savepoint).

### Widget catalog (`app/services/dashboard.py`)

Each widget declares: permissions (any of), plan feature key (`BASIC` = every plan, or a dashboard key), module,
business types, refresh hint, server cache time, whether it is about the signed-in person, and an optional `shape`
that removes money per person after the cache. New keys are added to `FEATURES`/`FEATURE_GROUPS` in
`app/core/catalog.py` and to a widget's `plan_feature`; nothing else changes.

| Key | Permission | Plan | Module · types | Refresh / cache |
|---|---|---|---|---|
| today_sales | reports.view | basic | reports | 60 s / 60 s |
| open_bills | orders.view_all or orders.pay (₹ only with orders.pay / reports.view) | basic | — | 20 s / 10 s |
| payment_claims | orders.pay | basic | restaurant, café | 20 s / 10 s |
| ready_to_pay | orders.pay | basic | restaurant, café | 20 s / 10 s |
| ready_to_serve | tables.view | basic | tables · restaurant, café | 15 s / 5 s |
| my_tables | tables.view (needs a staff record) | basic | tables · restaurant, café | 20 s / 10 s |
| kitchen | kitchen.view | basic | kitchen · restaurant, café, cloud kitchen | 15 s / 5 s |
| low_stock | inventory.view | basic | inventory | 300 s / 300 s |
| my_day | reports.view_own or reports.view (₹ only with orders.pay) | basic | reports | 60 s / 30 s |
| my_collection | orders.pay (needs a staff record) | basic | — | 60 s / 30 s |
| payment_split, hourly_sales, top_items | reports.view | dashboard_insights | reports | 60 s / 60 s |
| voids_comps | reports.view (₹ only for the owner) | dashboard_insights | reports | 60 s / 60 s |
| floor_live | tables.view | dashboard_live | tables · restaurant, café | 20 s / 10 s |
| kitchen_delays | kitchen.view | dashboard_live | kitchen · restaurant, café, cloud kitchen | 15 s / 5 s |

### Caching and load (`app/services/dashboard_cache.py`)

Results are cached per business (per person for "my" widgets) and per day, in Redis so every API worker shares them.
If Redis is down or answers slower than 0.25 s, the dashboard uses a small in-process cache for 30 s and tries Redis
again later; the cache can never fail or hold up a request. The app fetches the whole dashboard once a minute and the
live widgets (refresh ≤ 20 s) every 15–20 s with `widgets=`; both pause while the screen is hidden. Live counts are
COUNT / GROUP BY queries, never ticket bodies. The kitchen's Home also polls the active tickets every 5 s for the voice
(as the kitchen display does).

### Plan features

`dashboard_insights` and `dashboard_live` live in `plans.features` and `tenant_configs.feature_overrides` (JSON, no
schema change). Migration `0066` (data only, `plans` table only, idempotent, with a downgrade that removes the keys)
adds them to the existing default plans: Pro both, Standard `dashboard_live`. Other plans are left for the super admin.

### App

- `src/app/(app)/home.tsx` → `features/home/HomeScreen.tsx` (layout, alerts strip, kitchen panel, plan card, locked
  card), `widgets.tsx` (one renderer per widget; the hourly chart card is not itself pressable because its
  bars are), `widgetMeta.ts` (titles, icons, screens), `useDashboard.ts` (full + live refresh, offline snapshot),
  `homeLogic.ts` (merge, alerts), `landing.ts` (where sign-in lands).
- `src/lib/returnTo.ts` (deep link to come back to), `src/store/homeSnapshot.ts` (offline copy),
  `features/ops/useKitchenAlerts.ts` (new-order beep and voice, shared by Home and the kitchen display),
  `prefs.startOnKitchenDisplay`.
- Strings: `home.*` in en / hi / gu.

### Tests

- Backend `tests/integration/test_dashboard.py`: plan groups and the plan editor; widgets per role, custom role and
  business type; the owner's locked list; Home numbers equal Reports; waiter and kitchen responses contain no money;
  managers get voids/comps counts without ₹; ready to pay after serving; tenant isolation; Redis down or slow; local
  cache. `/dashboard` is in `PROTECTED_ROUTES`.
- App: `features/home/__tests__` (landing, return-to, refresh merge, alerts, every widget has a title) and the bottom-bar
  tests in `components/nav/__tests__/shell.test.ts`.

## Follow-ups (not done on purpose)

- **Indexes**: `orders` has only `(tenant_id, created_at)`; open bills and active kitchen tickets are filtered by status.
  Measure with `EXPLAIN ANALYZE` on large seeded data first; if needed, add partial indexes (one migration per table).
- **Average prep time**: needs a `kots.ready_at` column (the time a ticket became ready). Today Home shows counts and
  the oldest ticket instead.
- **Business-day cutoff** (e.g. a day that ends at 4 am): change Reports and Home together.
- **Owner-chosen widgets per role**: not in this version.
- **Staff on shift**: there is no business-wide list of signed-in devices yet.
- "My collection" credits a bill to whoever settled it; part payments taken by someone else are not split out.
