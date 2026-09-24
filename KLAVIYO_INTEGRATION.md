# Klaviyo Integration

This guide covers what the integration sends to Klaviyo, where in the code each piece lives, and how to set it up.

Everything is configured in **Admin → Settings → Klaviyo**. Only admins can see or change it. Assistants and the analytics role can't.

---

## 1. Setup (about 10 minutes)

1. **Run the migration.** Run `klaviyo-integration-migration.sql` in the Supabase SQL editor. It adds the `klaviyo_*` columns to `site_settings`, and it is safe to re-run.
2. **Create a private API key.** In Klaviyo, go to **Settings → API keys → Create Private API Key** and choose **Custom** access:
   - Accounts: **Read**
   - Events: **Full**
   - Lists: **Read** (or Full)
   - Profiles: **Full**
   - Subscriptions: **Full**
3. **Create a list** in Klaviyo (for example "Newsletter") if you don't have one yet.
4. **In Admin → Settings → Klaviyo:**
   1. Paste the private key (`pk_…`).
   2. Click **Test connection**. This fills in your **Site ID / public key** and loads your lists into the dropdown.
   3. Pick your **Newsletter list**.
   4. Click **Save Klaviyo settings**.
   5. Switch the integration to **Enabled**.
   6. Optional: enter your email and click **Send test event**. A metric called **"VYTA Test Event"** should appear under **Analytics → Metrics** within a minute.
5. **Optional backfill.** Click **Sync consenting customers** to subscribe every existing customer who ticked the marketing-consent box at signup. Customers who didn't consent are never subscribed.

`KLAVIYO_PRIVATE_API_KEY` in the environment is an optional fallback for the private key. The value saved in Admin always wins over it.

---

## 2. What is sent

### Server-side events (the "Order & checkout events" switch)

These events come from our server, where the buyer's email is known for certain. Each one carries a `unique_id`, so Klaviyo drops duplicates caused by webhook retries or re-polls.

| Metric | When | Where it's sent from | Value |
|---|---|---|---|
| **Started Checkout** | Buyer is handed off to the Stealth Health hosted payment page | `app/api/checkout/puramass/route.ts` | Cart plus shipping. `CheckoutURL` is the payment link, so it can be used as the "resume checkout" button |
| **Placed Order** | Stealth Health payment succeeds (webhook or poll), when the fulfillment invoice is created | `lib/payments/puramass-fulfillment.ts` | Order total |
| **Placed Order** | e-Transfer or pickup order is submitted | `app/api/orders-email/route.ts` | Order total |
| **Ordered Product** | Sent once per line of every Placed Order | same as above | Line total |
| **Confirmed Order** | Admin sets an order to *confirmed*, for example when an e-Transfer payment arrives | `app/api/admin/orders/[id]/route.ts` | Order total |
| **Fulfilled Order** | Shipment goes in transit (Easyship webhook) or admin sets *shipped* | `app/api/webhooks/easyship/route.ts`, admin order route | Includes `TrackingNumber`, `TrackingURL` and `Carrier` |
| **Delivered Order** | Easyship reports delivered, or admin sets *delivered* | same | |
| **Cancelled Order** | Admin cancels an order | admin order route | |
| **Refunded Order** | Admin refunds an order | `app/api/admin/orders/[id]/refund/route.ts` | |

Placed Order properties follow Klaviyo's e-commerce conventions: `OrderId`, `Items[]` (`ProductName`, `SKU`, `Quantity`, `ItemPrice`, `RowTotal`…), `ItemNames`, `Categories`, `DiscountValue`, `Shipping`, `Subtotal`, `Source` and `ShippingAddress`. Klaviyo's built-in revenue attribution and flow templates work with them unchanged.

### Account sync (the "Sync new accounts" switch)

This runs on signup, from `app/api/customer/register-alert/route.ts`, and does three things:
- Creates or updates the Klaviyo profile with email, name, phone (E.164 only) and `external_id` set to our customer id.
- Sends a **Created Account** event.
- If the customer ticked the consent box, subscribes them to the chosen list with email marketing consent. Nobody else is ever subscribed.

### Onsite (the "Onsite tracking & signup forms" switch)

When this is on, `klaviyo.js` loads on the storefront. It loads **only after the visitor accepts the cookie banner**, the same rule the Meta Pixel follows.

- **Viewed Product** fires on the product page, along with `trackViewedItem`, which powers "recently viewed" blocks.
- **Added to Cart** fires when an item is added to the cart.
- **Viewed Cart** fires when the cart is viewed.
- Signed-in customers are **identified**, so their browsing attaches to their profile.
- Any **signup forms or pop-ups** you publish in Klaviyo (**Sign-up forms → Create**) appear automatically. No code is needed.

Two events are deliberately **not** sent from the browser: Started Checkout and Placed Order. Both come from the server, and sending them twice would put buyers into flows twice.

The code for this lives in `lib/analytics/klaviyo-onsite.ts` (the forwarder, called from the existing GA4 helpers in `lib/analytics/ecommerce.ts`) and `components/SiteTracking.tsx` (the script loader and identify call).

---

## 3. Recommended flows to build in Klaviyo

| Flow | Trigger metric | Notes |
|---|---|---|
| Welcome series | Added to list (your newsletter list) | Consented signups plus Klaviyo form signups |
| Abandoned checkout | **Started Checkout** | Flow filter: *Placed Order zero times since starting this flow*. Use `{{ event.CheckoutURL }}` for the button |
| Browse abandonment | **Viewed Product** | Only reaches identified visitors (signed in, or clicked a Klaviyo email) |
| Abandoned cart | **Added to Cart** | Same identification caveat |
| Order confirmation / thank you | **Placed Order** | `{{ event.Items }}` loops the lines |
| Payment received (e-Transfer) | **Confirmed Order** | |
| Shipping notification | **Fulfilled Order** | `{{ event.TrackingURL }}` |
| Delivered / review request | **Delivered Order** | Wait a few days, then link to the product review page |
| Win-back | **Placed Order**, as a segment | For example "placed order at least once, but not in the last 90 days" |
| Replenishment | **Ordered Product** | Filter by `ProductName` |

---

## 4. Code map

| File | Purpose |
|---|---|
| `klaviyo-integration-migration.sql` | `site_settings` columns |
| `lib/klaviyo/settings.ts` | Pure settings shaping: on/off rules, env fallback, public-key gating |
| `lib/klaviyo/payload.ts` | Pure JSON:API body builders (profile, event, E.164 phone) |
| `lib/klaviyo/client.ts` | REST client: events, profile import, list subscribe, account and lists. Pinned revision is `KLAVIYO_REVISION` |
| `lib/klaviyo/events.ts` | Domain events: `trackPlacedOrder`, `trackStartedCheckout`, `trackOrderStatus(ById)`, `syncNewCustomer` |
| `lib/klaviyo/admin-auth.ts` | Admin-only gate for the Klaviyo admin endpoints |
| `app/api/admin/klaviyo/test` | "Test connection" and "Send test event" |
| `app/api/admin/klaviyo/sync-customers` | Backfill of consenting customers into the list |
| `app/api/admin/settings/route.ts` | Saves the settings. The private key is **write-only**: the API only reports whether it's set and where it came from |
| `lib/site-config.ts` | Exposes **only** the public Site ID to the storefront, and only when the integration and onsite tracking are both on |
| `lib/klaviyo/klaviyo.test.ts` | Unit tests: `node --test --experimental-strip-types lib/klaviyo/klaviyo.test.ts` |

## 5. Guarantees

- **Klaviyo can't break the store.** Every Klaviyo call is best-effort and time-limited (8 seconds). It never throws into checkout, payment webhooks or signup.
- **The private key never reaches a browser.** It isn't in `/api/site-config`, and `GET /api/admin/settings` returns only a "configured" flag.
- **Only consenting customers are subscribed.** Every buyer still gets a profile and order events, which is normal transactional data in Klaviyo. Marketing emails go only to subscribed profiles.
- **Duplicates are dropped.** Events carry `unique_id`s (order or invoice id plus the metric), so retries don't double-count revenue.
- **API version upkeep.** The API revision is pinned in `lib/klaviyo/client.ts`. Klaviyo supports each revision for two years, so bump it before it's retired.
