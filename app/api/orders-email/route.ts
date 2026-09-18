import { NextRequest, NextResponse, after } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  sendETransferOrderAck,
  sendAdminETransferNotice,
  sendETransferInstructions,
} from "@/lib/email";
import { renderETransferInstructions } from "@/lib/etransfer";
import { checkRateLimit, getClientIp, RATE_LIMITS } from "@/lib/rate-limit";
import { autoCreateShipmentForOrder } from "@/lib/shipping/auto-shipment";
import { createInvoiceForOrder } from "@/lib/admin/order-invoice-server";
import { resolvePriceMap } from "@/lib/pricing/resolve";
import {
  packPriceFor, packSizesFor, round2 as roundMoney, vialPriceFor, vialsPerBoxOf,
} from "@/lib/pricing";
import {
  resolveShippingCost,
  getShippingConfig,
  type ShippingConfig,
} from "@/lib/easyship";
import type { EasyshipRateRequest } from "@/lib/types/ecommerce";
import {
  readVisitorContext,
  attributionColumns,
  linkVisitorIdentity,
  stampVisitorMilestone,
} from "@/lib/analytics/attribution-server";

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

interface CheckoutItem {
  id?: string;
  name: string;
  price: number;
  quantity: number;
  strength?: string;
  /** 'vial' (single vial) or 'case' (any multi-vial pack). Absent → 'case'. */
  unit?: "vial" | "case";
  /** Vials in ONE unit of this line — 1 for a single vial, N for an N-pack.
   *  Absent (an older cart) → derived from `unit` + `vialsPerBox`. Validated
   *  server-side against the product's own pack options. */
  packSize?: number;
  /** Vials in one case; used to convert a legacy case line to vials. */
  vialsPerBox?: number;
}

interface CheckoutShipping {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

interface OrdersEmailBody {
  items: CheckoutItem[];
  shipping: CheckoutShipping;
  fulfillment_type?: "shipment" | "pickup";
  shippingCost?: number;
  selectedCourier?: {
    courier_id?: string;
    courier_name?: string;
    service_name?: string;
  };
  referralCode?: string;
  customerId?: string;
  idempotencyKey?: string;
}

function generateOrderNumber(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i++)
    code += chars[Math.floor(Math.random() * chars.length)];
  return `AMC-${code}`;
}

// Server-authoritative shipping. Re-quotes the cheapest allowed courier (or the
// configured flat fallback when Easyship is down/disabled) so the amount we
// charge never depends on what the browser posted. Never throws — a total
// failure degrades to 0 and the caller floors it with the client's selection.
async function computeAuthoritativeShipping(
  shipping: CheckoutShipping,
  totalQty: number,
  cfg: ShippingConfig,
): Promise<number> {
  try {
    if (!shipping.postalCode || !shipping.country) {
      return round2(Number(cfg.flatRate) || 0);
    }
    const factor = Math.max(1, totalQty);
    const baseWeight = cfg.box.weight ?? 0.5;
    const payload: EasyshipRateRequest = {
      origin_country_alpha2: cfg.origin.country_alpha2 || "CA",
      origin_postal_code: cfg.origin.postal_code || "",
      origin_state: cfg.origin.state || undefined,
      origin_city: cfg.origin.city || undefined,
      destination_country_alpha2:
        shipping.country.length === 2 ? shipping.country : "CA",
      destination_postal_code: shipping.postalCode,
      destination_city: shipping.city ?? "",
      destination_state: shipping.state || undefined,
      total_actual_weight: baseWeight * factor,
      boxes: [
        {
          length: cfg.box.length ?? 15,
          width: cfg.box.width ?? 10,
          height: cfg.box.height ?? 5,
          weight: baseWeight * factor,
        },
      ],
    };
    const { cost } = await resolveShippingCost(payload, cfg);
    return round2(Number(cost) || 0);
  } catch {
    return round2(Number(cfg.flatRate) || 0);
  }
}

// POST /api/orders-email
// Public storefront route for the e-Transfer checkout flow. Creates the
// order, sends an acknowledgement to the customer, notifies admins, and (for
// shipment orders) returns the Interac e-Transfer details so the confirmation
// screen can show them on-page — the email is a convenience, not the only
// channel.
export async function POST(req: NextRequest) {
  // Per-IP rate limit (same bucket as the legacy crypto orders POST).
  const ip = getClientIp(req);
  const rl = checkRateLimit(`orders:${ip}`, RATE_LIMITS.orders);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Too many orders. Try again in ${rl.retryAfter} seconds.` },
      { status: 429 },
    );
  }

  let body: OrdersEmailBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const { items, shipping } = body;
  if (!items?.length) {
    return NextResponse.json({ error: "No items in cart" }, { status: 400 });
  }
  if (!shipping?.firstName || !shipping?.lastName || !shipping?.email) {
    return NextResponse.json(
      { error: "First name, last name, and email are required" },
      { status: 400 },
    );
  }

  // Every payment instruction is delivered to this address, so a malformed
  // email means the buyer can never be reached — reject it up front (the
  // client gate now enforces the same rule).
  const email = String(shipping.email).trim();
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json(
      { error: "Please enter a valid email address" },
      { status: 400 },
    );
  }

  const fulfillmentType: "shipment" | "pickup" =
    body.fulfillment_type === "pickup" ? "pickup" : "shipment";

  if (
    fulfillmentType === "shipment" &&
    (!shipping.address || !shipping.city || !shipping.postalCode)
  ) {
    return NextResponse.json(
      { error: "Shipping address is required for shipments" },
      { status: 400 },
    );
  }

  // Verify the customer (never trust the client id).
  let verifiedCustomerId: string | null = null;
  if (body.customerId) {
    const { data: customer } = await db
      .from("customers")
      .select("id")
      .eq("id", body.customerId)
      .maybeSingle();
    if (customer) {
      verifiedCustomerId = customer.id;
    }
  }

  // ---- Server-authoritative line pricing ----
  // Item prices are NEVER trusted from the browser. Every line is re-resolved
  // from the catalog (base → active pricelist → per-customer override) with the
  // same resolver the storefront renders with. A line whose product can't be
  // priced is rejected so a stale/tampered cart can't slip through.
  const lineProductIds = items
    .map((it) => (typeof it.id === "string" ? it.id : ""))
    .filter((id) => UUID_RE.test(id));
  const priceMap = await resolvePriceMap(db, {
    customerId: verifiedCustomerId,
    productIds: lineProductIds,
  });

  // Per-vial catalog details (vial price + case size). A `vial` line is priced
  // at the explicit vial price, falling back to the case price ÷ vials_per_box
  // — the same rule the storefront renders with.
  const { data: vialRows } = await db
    .from("products")
    .select("id, vial_price, vials_per_box, pack_sizes, pack_options")
    .in(
      "id",
      lineProductIds.length
        ? lineProductIds
        : ["00000000-0000-0000-0000-000000000000"],
    );
  const detailById = new Map((vialRows ?? []).map((p: any) => [p.id, p]));

  let subtotal = 0;
  let clientSubtotal = 0;
  let totalQty = 0;
  // Stock is tracked in vials, so accumulate the vial-equivalent demand per
  // product (a case consumes `vials_per_box` vials).
  const vialsWantByProduct = new Map<string, number>();
  const priced: Array<{
    id: string;
    name: string;
    price: number;
    quantity: number;
    strength?: string;
    unit: "vial" | "case";
    pack_size: number;
    vials_per_box: number;
  }> = [];
  for (const it of items) {
    const qty = Math.max(0, Math.floor(Number(it.quantity) || 0));
    if (qty <= 0) continue;
    const id = typeof it.id === "string" ? it.id : "";
    const resolved = UUID_RE.test(id) ? priceMap.get(id) : undefined;
    if (!resolved) {
      return NextResponse.json(
        {
          error: `We couldn't verify the price for "${it.name}". Please refresh your cart and try again.`,
          code: "price_unavailable",
        },
        { status: 409 },
      );
    }
    const detail: any = detailById.get(id);
    const vialsPerBox = vialsPerBoxOf(detail?.vials_per_box);

    // Pack size is NEVER trusted from the browser: it decides both the price
    // and how much stock the line consumes. Take the client's number only when
    // the product actually offers that pack; otherwise fall back to what the
    // line's `unit` has always meant.
    const offeredPacks = packSizesFor({
      price: resolved.base,
      vial_price: detail?.vial_price ?? null,
      vials_per_box: vialsPerBox,
      pack_sizes: detail?.pack_sizes ?? null,
      pack_options: detail?.pack_options ?? null,
    });
    const requestedPack = Math.floor(Number(it.packSize));
    const legacyPack = it.unit === "vial" ? 1 : vialsPerBox;
    const packSize =
      Number.isFinite(requestedPack) && offeredPacks.includes(requestedPack)
        ? requestedPack
        : legacyPack;
    const unit: "vial" | "case" = packSize > 1 ? "case" : "vial";

    // Same vial price rule the storefront renders with (explicit vial price,
    // else the case price ÷ vials_per_box). A pricelist / per-customer
    // override still wins: its case price is spread back over the case to give
    // the per-vial figure every pack is then built from, so a pack of
    // vials_per_box lands exactly on the overridden price.
    const catalogVialPrice = vialPriceFor({
      price: resolved.base,
      vial_price: detail?.vial_price ?? null,
      vials_per_box: vialsPerBox,
    });
    const effectiveVialPrice =
      resolved.source === "base"
        ? catalogVialPrice
        : roundMoney(resolved.price / vialsPerBox);
    // Pack rule: the admin's fixed price for this pack when there is one,
    // otherwise the vial price × pack size.
    //
    // A pricelist / per-customer override deliberately drops the fixed pack
    // price: that override has already restated what this customer pays per
    // vial, and layering a catalog pack price on top would quote them the
    // public figure instead of their own.
    const unitPrice = packPriceFor(
      {
        price: resolved.base,
        vial_price: effectiveVialPrice,
        vials_per_box: vialsPerBox,
        pack_options: resolved.source === "base" ? (detail?.pack_options ?? null) : null,
      },
      packSize,
    );
    const vialsPerUnit = packSize;

    subtotal += unitPrice * qty;
    clientSubtotal += (Number(it.price) || 0) * qty;
    totalQty += qty;
    vialsWantByProduct.set(
      id,
      (vialsWantByProduct.get(id) ?? 0) + qty * vialsPerUnit,
    );
    priced.push({
      id,
      name: it.name,
      price: unitPrice,
      quantity: qty,
      strength: it.strength,
      unit,
      pack_size: packSize,
      vials_per_box: vialsPerBox,
    });
  }
  if (priced.length === 0) {
    return NextResponse.json({ error: "No valid items in cart" }, { status: 400 });
  }
  subtotal = round2(subtotal);

  // Prices only ever moved UP since the buyer's cart was priced → make them
  // re-confirm rather than silently overcharging. A price drop is applied
  // silently in the buyer's favour.
  if (subtotal - round2(clientSubtotal) > 0.01) {
    return NextResponse.json(
      {
        error:
          "Prices in your cart have changed. Please review your order and try again.",
        code: "price_changed",
      },
      { status: 409 },
    );
  }

  // ---- Stock availability at placement ----
  // Reject an order we can't fulfil so the buyer never completes an impossible
  // purchase. (Final oversell protection also runs at admin confirmation.)
  {
    const { data: stockRows } = await db
      .from("products")
      .select("id, name, stock_quantity, active, is_active")
      .in(
        "id",
        lineProductIds.length
          ? lineProductIds
          : ["00000000-0000-0000-0000-000000000000"],
      );
    const stockById = new Map((stockRows ?? []).map((p: any) => [p.id, p]));
    // Demand is measured in vials (a case = vials_per_box vials).
    for (const [pid, want] of vialsWantByProduct) {
      const row: any = stockById.get(pid);
      if (!row || row.active === false || row.is_active === false) {
        return NextResponse.json(
          {
            error:
              "One or more items are no longer available. Please refresh your cart.",
            code: "unavailable",
          },
          { status: 409 },
        );
      }
      const available = Number(row.stock_quantity ?? 0);
      if (available < want) {
        return NextResponse.json(
          {
            error:
              available > 0
                ? `Only ${available} of "${row.name}" left in stock. Please adjust your cart.`
                : `"${row.name}" just sold out. Please remove it and try again.`,
            code: "insufficient_stock",
          },
          { status: 409 },
        );
      }
    }
  }

  // ---- Server-authoritative shipping + total ----
  // This checkout carries no discount. The only offer the store runs is the
  // paid-ads welcome discount, which is a hosted-checkout promo settled in
  // `/api/checkout/puramass` (see lib/promos/ad-discount.ts) — so orders placed
  // here are always at list price, and the discount columns below record zero.
  const discountTotal = 0;

  const shippingCfg = await getShippingConfig();
  let shippingCost = 0;
  if (fulfillmentType === "shipment") {
    const authoritative = await computeAuthoritativeShipping(
      shipping,
      totalQty,
      shippingCfg,
    );
    const clientShipping = Math.max(0, Number(body.shippingCost) || 0);
    // Never charge below the authoritative amount (closes the "$0 shipping"
    // tamper and the fallback rate the UI showed but never added).
    shippingCost = round2(Math.max(authoritative, clientShipping));
  }

  const total = round2(subtotal - discountTotal + shippingCost);

  // e-Transfer details for the on-screen confirmation (and reused by the
  // background instructions email). Fetched once here so the buyer always has
  // the recipient/amount/security answer even if the email never arrives.
  const etSettings =
    fulfillmentType === "shipment"
      ? (
          await db
            .from("site_settings")
            .select(
              "etransfer_enabled, etransfer_recipient_email, etransfer_security_question, etransfer_security_answer_hint, etransfer_instructions_subject, etransfer_instructions_body",
            )
            .limit(1)
            .maybeSingle()
        ).data
      : null;

  const idempotencyKey =
    typeof body.idempotencyKey === "string" && body.idempotencyKey.trim()
      ? body.idempotencyKey.trim().slice(0, 100)
      : null;

  const buildEtransferPayload = (orderNumber: string, orderTotal: number) => {
    if (fulfillmentType !== "shipment") return null;
    const rendered = renderETransferInstructions({
      orderNumber,
      total: orderTotal,
      shipping,
      settings: etSettings,
    });
    if (!rendered.enabled) return null;
    return {
      recipientEmail: rendered.recipientEmail,
      securityQuestion: rendered.securityQuestion,
      securityAnswerHint: rendered.securityAnswerHint,
      amount: round2(orderTotal),
      orderNumber,
    };
  };

  // Idempotency: a retried submit (dropped response, double click) with the
  // same key returns the existing order instead of creating a duplicate.
  if (idempotencyKey) {
    const { data: existing } = await db
      .from("orders")
      .select("id, order_number, total, fulfillment_type")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({
        success: true,
        deduped: true,
        order: {
          id: existing.id,
          order_number: existing.order_number,
          total: Number(existing.total),
          fulfillment_type: existing.fulfillment_type,
        },
        etransfer: buildEtransferPayload(
          existing.order_number,
          Number(existing.total),
        ),
      });
    }
  }

  // Insert the order. Retry the order_number a few times on collisions, and
  // degrade gracefully if the idempotency_key column hasn't been migrated yet.
  let inserted: { id: string; order_number: string } | null = null;
  let includeIdempotency = idempotencyKey != null;
  // Freeze the acquisition channel onto the order. Read from the visitor's own
  // cookies rather than the request body so a client cannot claim an
  // attribution that isn't theirs.
  const visitor = readVisitorContext(req.cookies);
  const attribution = attributionColumns(visitor);
  let includeAttribution = attribution.attribution_channel != null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const orderNumber = generateOrderNumber();
    const row: Record<string, unknown> = {
      customer_id: verifiedCustomerId,
      order_number: orderNumber,
      items: priced,
      total,
      subtotal,
      shipping_cost: shippingCost,
      discount_total: discountTotal,
      discount_amount: discountTotal,
      email,
      shipping_address: shipping,
      shipping_carrier: body.selectedCourier?.courier_name ?? null,
      shipping_method: body.selectedCourier?.service_name ?? null,
      easyship_courier_id: body.selectedCourier?.courier_id ?? null,
      fulfillment_type: fulfillmentType,
      status: "pending",
      source:
        fulfillmentType === "pickup" ? "e-transfer-pickup" : "e-transfer",
      referral_code: body.referralCode ?? null,
      payment_amount_expected: total.toFixed(2),
    };
    if (includeIdempotency) row.idempotency_key = idempotencyKey;
    if (includeAttribution) Object.assign(row, attribution);

    const { data, error } = await db
      .from("orders")
      .insert(row)
      .select("id, order_number")
      .single();

    if (!error && data) {
      inserted = data;
      break;
    }

    const code = (error as any)?.code;
    const msg = String((error as any)?.message ?? "");

    // idempotency_key column not migrated yet → retry this attempt without it.
    if (
      includeIdempotency &&
      (code === "42703" || msg.includes("idempotency_key"))
    ) {
      includeIdempotency = false;
      attempt--;
      continue;
    }

    // Same for the attribution columns, which arrive with
    // marketing-attribution-migration.sql. An order must never fail to be
    // placed because a reporting column is missing.
    if (includeAttribution && (code === "42703" || msg.includes("attribution"))) {
      includeAttribution = false;
      attempt--;
      continue;
    }

    if (code === "23505") {
      // A concurrent request with the SAME idempotency key won the race →
      // return that order instead of erroring.
      if (includeIdempotency && msg.includes("idempotency")) {
        const { data: existing } = await db
          .from("orders")
          .select("id, order_number, total, fulfillment_type")
          .eq("idempotency_key", idempotencyKey)
          .maybeSingle();
        if (existing) {
          return NextResponse.json({
            success: true,
            deduped: true,
            order: {
              id: existing.id,
              order_number: existing.order_number,
              total: Number(existing.total),
              fulfillment_type: existing.fulfillment_type,
            },
            etransfer: buildEtransferPayload(
              existing.order_number,
              Number(existing.total),
            ),
          });
        }
      }
      // Otherwise it was an order_number collision → retry with a new number.
      continue;
    }

    console.error("orders-email insert error:", error);
    return NextResponse.json(
      { error: (error as any)?.message ?? "Failed to create order" },
      { status: 500 },
    );
  }
  if (!inserted) {
    return NextResponse.json(
      { error: "Could not allocate an order number; please retry" },
      { status: 500 },
    );
  }

  // Attach the buyer's email to the visitor row and mark them as having
  // reached checkout. The email is the join that lets a later payment — which
  // arrives without any cookie — be traced back to the campaign that won them.
  // Awaited-free: reporting must not delay the confirmation screen.
  void linkVisitorIdentity(db, visitor.anonymousId, {
    email,
    customerId: verifiedCustomerId,
  });
  void stampVisitorMilestone(db, visitor.anonymousId, "checkout_at");

  const customerName =
    [shipping.firstName, shipping.lastName].filter(Boolean).join(" ").trim() ||
    "Customer";

  // The order row is committed, so the customer can be sent to the confirmation
  // screen immediately. Everything below (transactional emails + Easyship
  // shipment creation) is best-effort follow-up whose result never feeds the
  // HTTP response — the on-screen `etransfer` payload is the reliable channel.
  const orderId = inserted.id;
  const orderNumber = inserted.order_number;

  after(async () => {
    // Send customer ack + log.
    try {
      const ack = await sendETransferOrderAck({
        to: email,
        customerName,
        orderNumber,
        items: priced.map((it) => ({
          name: it.name,
          quantity: it.quantity,
          price: it.price,
          strength: it.strength,
          unit: it.unit,
          packSize: it.pack_size,
          vialsPerBox: it.vials_per_box,
        })),
        subtotal,
        shipping: shippingCost,
        total,
        fulfillmentType,
      });
      await db.from("fulfillment_email_log").insert({
        order_id: orderId,
        kind: "etransfer_ack",
        to_email: email,
        subject: ack.subject ?? null,
        message_id: ack.messageId ?? null,
        success: ack.success,
        error: ack.success ? null : (ack as any).error ?? null,
      });
    } catch (e) {
      console.error("etransfer_ack send/log failed:", e);
    }

    // Interac e-Transfer payment instructions. Skipped for pickup (pay in
    // person). The same details are already on the buyer's confirmation screen,
    // so a send failure here is logged but never strands the customer.
    if (fulfillmentType === "shipment") {
      try {
        const rendered = renderETransferInstructions({
          orderNumber,
          total,
          shipping,
          settings: etSettings,
        });
        if (rendered.enabled) {
          const instr = await sendETransferInstructions({
            to: email,
            customerName: rendered.customerName,
            orderNumber,
            total,
            recipientEmail: rendered.recipientEmail,
            securityQuestion: rendered.securityQuestion,
            securityAnswerHint: rendered.securityAnswerHint,
            customSubject: rendered.subject,
            customBodyText: rendered.body,
          });
          await db.from("fulfillment_email_log").insert({
            order_id: orderId,
            kind: "etransfer_instructions",
            to_email: email,
            subject: instr.subject ?? null,
            message_id: instr.messageId ?? null,
            success: instr.success,
            error: instr.success ? null : (instr as any).error ?? null,
          });
        }
      } catch (e) {
        console.error("automatic etransfer instructions failed:", e);
      }
    }

    // Admin notification — best-effort.
    try {
      const { data: settings } = await db
        .from("site_settings")
        .select("admin_emails")
        .limit(1)
        .maybeSingle();
      const adminEmails = Array.isArray(settings?.admin_emails)
        ? (settings!.admin_emails as string[]).filter(Boolean)
        : [];
      if (adminEmails.length > 0) {
        const notice = await sendAdminETransferNotice({
          to: adminEmails,
          orderNumber,
          customerName,
          customerEmail: email,
          total,
          fulfillmentType,
        });
        await db.from("fulfillment_email_log").insert({
          order_id: orderId,
          kind: "etransfer_admin_notice",
          to_email: adminEmails.join(", "),
          subject: notice.subject ?? null,
          message_id: notice.messageId ?? null,
          success: notice.success,
          error: notice.success ? null : (notice as any).error ?? null,
        });
      }
    } catch (e) {
      console.error("admin notification failed:", e);
    }

    // Every placed order gets a draft invoice (best-effort, idempotent).
    try {
      const res = await createInvoiceForOrder(db, orderId);
      if (!res.ok) console.error("order invoice creation failed:", res.error);
    } catch (e) {
      console.error("order invoice creation threw:", e);
    }

    // Every placed order generates an Easyship shipment record (best-effort).
    try {
      await autoCreateShipmentForOrder(
        db,
        {
          id: orderId,
          easyship_shipment_id: null,
          fulfillment_type: fulfillmentType,
          shipping_address: shipping,
          email,
          total,
          easyship_courier_id: body.selectedCourier?.courier_id ?? null,
        },
        true,
        body.selectedCourier?.courier_id,
      );
    } catch (e) {
      console.error("auto shipment creation failed:", e);
    }
  });

  return NextResponse.json({
    success: true,
    order: {
      id: inserted.id,
      order_number: inserted.order_number,
      total,
      fulfillment_type: fulfillmentType,
    },
    etransfer: buildEtransferPayload(orderNumber, total),
  });
}
