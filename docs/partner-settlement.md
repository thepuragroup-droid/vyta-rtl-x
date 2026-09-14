# Partner settlement ledger (`GET /partner/settlement`)

Stealth Health now publish their own per-appointment financials read-only, so
we can reconcile from the API instead of asking for a spreadsheet. This is what
we built against it, and — just as important — what we still need them to
confirm.

Surfaced at **Admin → Stealth Health → Reconcile**.

## Why this is not just another endpoint

We already had an answer to "what does Stealth Health owe us". PR #134 computes
it from our hand-off ledger (`puramass_orders.subtotal_cents`) under the
commercial terms an admin types into the Terms tab.

Their feed is a **second, independent answer to the same question** — and it is
the one they invoice from, since it comes from the same engine as the White
Label Pay ledger rather than being a calculation built for the API.

So we did not replace ours with theirs. Both are computed, shown side by side,
and the gap between them is the subject of the Reconcile tab. Adopting their
number outright would delete the only independent check either side has;
ignoring it would mean reconciling against a figure nobody invoices from.

| | Source | Role |
|---|---|---|
| **Ours** | `puramass_orders` + configured terms | The expectation. Catches a mistake on either side. |
| **Theirs** | `partner_split` from the feed | What gets invoiced. The figure to reconcile against. |

## The figures move — so every pull is snapshotted

Their caveats say store cost is joined from the **current catalog** rather than
stamped at checkout, and that CAD-denominated store products are summed as
their USD-equivalent.

That means re-pulling January in March can legitimately return different
numbers for the same appointments, if a product price or an FX rate moved in
between. This is not hypothetical here: the vial/case price conversion changed
twice in recent history (PRs #139 and #140).

A number that moves underneath you cannot be reconciled against unless you keep
what you were shown. So:

- Every pull is written to `stealth_health_settlement_pulls` with its
  timestamp, the partner's own window totals, and the caveats that qualified
  them.
- Every appointment row is written to `stealth_health_settlement_rows`.
- The Reconcile tab compares a window's two most recent pulls and says so when
  the answer moved.

Schema: `stealth-health-partner-settlement-migration.sql` (run it in the
Supabase SQL editor like every other migration here).

## The four documented gotchas, and where each is handled

1. **`totals` covers the window, not the page.** Taken from the response and
   never re-summed from our pages. When we *do* hold every row, the difference
   between their total and our row sum is reported as
   `totals_row_delta_cents` — non-zero means we are not holding the whole
   window.
2. **`shipping: null` ≠ 0.** Null survives end to end: `shipping_cents` is
   nullable in the type, in the DB column, and in the totals. Zero would mean
   free shipping, which is a different fact.
3. **`partner_split` is gross of credits, chargebacks and manual adjustments,**
   so it will not always tie to a specific remittance to the cent. It is never
   re-derived from `revenue` and the fees — the split model is theirs and is
   not published. (In their own sample, `300.00 − 9.60 − 15.00 = 275.40`, while
   the split is `70.16`. There is no arithmetic here for us to reproduce.)
4. **`caveats[]` is read, not ignored.** Carried through verbatim to the
   snapshot and rendered in full on the tab.

## `split_model: null` is a setup gap, not a zero balance

When our revenue split is not configured on their side, every row reports a
split of 0 and `caveats[]` carries `split_model_unconfigured`.

We detect it two independent ways — the caveat code, *or* any row with a null
`split_model` — so a wording change on their side cannot silently turn a setup
gap into a reported zero. When it fires, a full-width banner takes over the tab
saying the figures underneath are not a statement of what we are owed.

## Matching is exact-only, and often will not match

**This is the weakest point of the integration and the thing most likely to
need their input.**

Their rows are keyed by `appointment_id` (`appt_abc123`). Our ledger knows a
hand-off by `transaction_id` (theirs, from `POST /partner/store/orders`) and
`partner_reference` (ours). Nothing in our schema is called an appointment, and
we do not use the clinical endpoints their docs suggest joining against.

So matching is **case-insensitive exact equality** against those two columns,
plus any link an operator has confirmed in
`stealth_health_appointment_links`. Anything it cannot place is reported as
unmatched. Fuzzy matching financial records invents links that look
authoritative and are not.

Because of that, the **window-level aggregate is the figure that always
works** — it needs no join at all. Per-appointment detail is a bonus that
arrives once the identifiers line up.

## Open questions for Stealth Health

These are the answers that would let us tighten the integration. None of them
block the aggregate reconciliation, which works today.

1. **How do we join `appointment_id` to a store order?** Is it equal to the
   `transaction_id` we get back from `POST /partner/store/orders`, derivable
   from it, or a separate identifier entirely? If separate, can the settlement
   row carry `partner_reference` or `transaction_id` so the join needs no
   guesswork?
2. **Does every PuraMass store checkout appear as its own row?** The sample row
   is clinical (`condition`, `medication`, `visit_type: asynchronous`), but the
   caveats mention store cost — so are our peptide orders their own
   appointments, or are store products rolled into a clinical appointment that
   may cover several of our hand-offs (or none)?
3. **What is `revenue`?** The gross patient charge, or goods only? And is
   `partner_split` already net of `processing_fee` / `consult_fee` /
   `shipping`, or are those informational?
4. **What timezone bounds `start`/`end`, and does the window filter on the
   appointment's `created_at` or on when it was paid?** We bound our side on
   `paid_at` (falling back to `created_at`), UTC. If the two differ, boundary
   days will disagree and every month-end reconciliation will show a spurious
   variance.
5. **How are refunds represented?** There is no refund field on the row. Does a
   refunded appointment drop out of the window, go negative, or stay at its
   original split? We track `refunded_total_cents` on our side and net it off.
6. **What FX rate converts CAD store products to USD-equivalent, and as of
   when?** If it is spot-at-pull-time, the figures move with FX as well as with
   the catalog.
7. **What does `white_label_account_settled` mean for us?** It is stored but
   nothing reads it yet.

## Files

| Path | What it is |
|---|---|
| `lib/payments/puramass-settlement.ts` | API client: pagination, window rules, money normalisation |
| `lib/admin/stealth-health-reconcile.ts` | Pure reconciliation — theirs vs ours |
| `lib/admin/partner-settlement-types.ts` | Wire shapes shared by server and browser |
| `lib/admin/partner-settlement-server.ts` | Snapshot storage and drift comparison |
| `app/api/admin/stealth-health/partner-settlement/route.ts` | `GET` stored / `POST` pull |
| `app/(admin)/admin/stealth-health/_components/ReconcileTab.tsx` | The dashboard tab |
| `stealth-health-partner-settlement-migration.sql` | Schema |

Tests (`node --test --import tsx <file>`):
`lib/payments/puramass-settlement.test.ts`,
`lib/admin/stealth-health-reconcile.test.ts`.
