# 2026-09-07 — The analytics role sees paid-ads sales only

## Summary

The `analytics` role is an **external marketing partner**: it reads the
analytics surface to judge the campaigns it runs, edits product copy, the
category taxonomy and the tracking settings — and has no access to customers,
invoices, orders or settings anywhere else in the admin.

It could nevertheless read the whole store's money. `/admin/analytics` served it
total sales, every product's revenue, the location tree, the buyer mix and the
full earnings split — organic, affiliate and direct sales included. That is the
business's revenue, not the partner's campaign performance.

From now on, **every sales figure served to that role counts only orders won by
a paid ad** — `google_ads`, `meta_ads`, `bing_ads`, `tiktok_ads`, `linkedin_ads`
and `other_paid`, the six `PAID_CHANNELS` that already define "Paid ads"
everywhere else in the admin. Organic, referral, affiliate, direct and
unattributed sales are filtered out **server-side, in the route, before any
aggregation** — the client never receives them, so the scope cannot be lifted by
reading the network tab or calling the API directly.

Admin and assistant are unaffected: they read the whole business exactly as
before.

## No database migration

The filter is on the attribution snapshot frozen onto each row when it was
created — `orders.attribution_channel`, `puramass_orders.attribution_channel`,
`customers.attribution_channel`, `visitor_attribution.first_channel` — all added
by `marketing-attribution-migration.sql`, each already indexed. One indexed
predicate, no new columns, and no way for the report to drift from the filter.

---

## What changed

### The scope — `lib/analytics/paid-scope.ts`

One module owns the rule, so no route can define "paid ads" for itself:

- `isPaidAdsScoped(role)` — true for `analytics` and nothing else.
- `scopeToPaidAds(query, scoped)` / `paidChannelFilter(query, column)` — the
  `in (…PAID_CHANNELS)` predicate, applied to the query before it is sent.
- `loadPaidVisitorScope(db)` + `isPaidVisitorRow(scope, row)` — visitors carry
  their channel on `visitor_attribution`, not on the activity row, so scoped
  traffic is matched in memory against the visitors ads won.
- `filterPaidOrderIds(db, ids)` — for the surfaces that hold money against an
  order id instead of carrying the channel (invoices, order line items).

**It fails closed.** If the attribution columns are not migrated, or a read
errors, nothing can be shown to be paid-ads — so the scoped reader is shown
zero, with a note saying why, rather than the unfiltered business.

### Store report — `GET /api/admin/analytics/store`

Both collectors, the customer mix and the traffic scan are filtered: orders,
revenue, products, categories, the location tree, buyers, the new/returning
split, visitors and registrations. The whole report is one consistent paid-ads
picture, so **conversion divides paid-ads orders by the traffic those ads
brought** rather than by everyone. `report.scope` says which view it is.

### Operational summary — `GET /api/admin/analytics/summary`

The funnel, the hosted-checkout ledger and registrations are filtered the same
way. Invoice revenue is scoped through the order each invoice was raised
against; an invoice with no order behind it cannot be shown to be paid-ads and
is left out rather than assumed in. **Inventory and incoming purchase orders are
not sales and stay whole** — that is stock the partner needs to see to plan
campaigns, and it says nothing about who bought what.

### Acquisition — `GET /api/admin/analytics/attribution`

All three scans are filtered, so the channel table, the campaign drill-down and
the earnings split contain the paid channels only — and `unattributed` is
necessarily zero.

### Product report — `GET /api/admin/products/report`

The `Units sold` and `Revenue` columns are computed from the line items of
paid-ads orders only. Stock, price and catalogue figures are unchanged. The
printed footnote says which of the two it is.

### What the reader is told

A number that is a subset must never read as the whole. So:

- **Admin → Analytics** carries a *Paid-ads view* banner above the tabs, stating
  what is counted and what is not.
- Every scoped API response carries `scope: 'paid_ads'` and a `notes` entry
  saying so, so an export or a direct API read is as clear as the page.
- The **Earnings by source** card adds a line explaining that its split is of
  ad-won revenue, not of the whole store — otherwise its single 100% bar would
  read as the entire business.

---

## Tests

`lib/analytics/paid-scope.test.ts` covers the rule and, above all, that it fails
closed: the role check, the exact channel list, the column each table names, the
visitor match on either identity, an unreadable visitor table matching nobody
rather than everybody, and a failed id lookup contributing no revenue.

```
node --test --import tsx lib/analytics/paid-scope.test.ts
```

---

## Known limitation

`lib/admin/api.ts` reads `orders` straight from the browser with the anon key,
and the `orders` RLS policy is `FOR ALL USING (true)`. That is a pre-existing,
store-wide posture, unchanged here — this work scopes what the *admin API*
serves. Tightening that policy is worth doing separately, and would close the
last path around this scope.
