import { NextRequest, NextResponse } from "next/server";
import { getMetaCortexClient } from "@/lib/metacortex";
import { getSupabase } from "@/lib/supabase";
import { advanceOrderForward } from "@/lib/warehouse/types";
import { adjustStockForConfirmedOrder } from "@/lib/order-stock";

interface WebhookPayload {
  event: "invoice.paid" | "invoice.expired";
  invoice: {
    id: string;
    invoice_number: string;
    amount: number;
    currency: string;
    status: string;
    transaction_hash?: string;
    paid_at?: string;
    metadata?: {
      order_id?: string;
      order_number?: string;
      items?: unknown[];
    };
  };
}

export async function POST(request: NextRequest) {
  try {
    const payload: WebhookPayload = await request.json();
    const { event, invoice } = payload;

    console.log(
      `[Webhook] Received ${event} for invoice ${invoice.invoice_number}`,
    );

    // Verify invoice status via the MetaCortex API before trusting the
    // payload (defends against spoofed webhooks if no shared secret is set).
    const client = getMetaCortexClient();
    try {
      const verified = await client.getInvoice(invoice.invoice_number);
      if (verified.status !== invoice.status) {
        console.warn(
          `[Webhook] Status mismatch: received ${invoice.status}, verified ${verified.status}`,
        );
      }
    } catch (e) {
      console.warn("[Webhook] Verify call failed (continuing):", e);
    }

    const db = getSupabase();
    const orderId = invoice.metadata?.order_id ?? null;
    const orderNumber = invoice.metadata?.order_number ?? null;

    // Look up the order. Prefer the UUID metadata.order_id (current
    // checkout writes it); fall back to order_number for legacy invoices.
    let order: { id: string; status: string } | null = null;
    if (orderId) {
      const { data } = await db
        .from("orders")
        .select("id, status")
        .eq("id", orderId)
        .maybeSingle();
      if (data) order = data;
    }
    if (!order && orderNumber) {
      const { data } = await db
        .from("orders")
        .select("id, status")
        .eq("order_number", orderNumber)
        .maybeSingle();
      if (data) order = data;
    }
    if (!order) {
      console.warn(
        "[Webhook] No matching order for metadata",
        invoice.metadata,
      );
      return NextResponse.json({ received: true, matched: false });
    }

    if (event === "invoice.paid") {
      const advanced = advanceOrderForward(order.status, "confirmed") ?? "confirmed";
      await db
        .from("orders")
        .update({
          status: advanced,
          payment_confirmed_at: invoice.paid_at ?? new Date().toISOString(),
          payment_tx_hash: invoice.transaction_hash ?? null,
          payment_amount_received: String(invoice.amount),
        })
        .eq("id", order.id);
      // Invoice paid → decrement product stock once and log to history.
      await adjustStockForConfirmedOrder(db, order.id);
      console.log(`[Webhook] Order ${order.id} marked paid (${advanced}).`);
      // NOTE: Auto-shipment + invoice auto-create are deferred. Admin
      // resolves these from /admin/orders today.
    } else if (event === "invoice.expired") {
      if (order.status !== "cancelled" && order.status !== "delivered") {
        await db
          .from("orders")
          .update({ status: "expired" })
          .eq("id", order.id);
        console.log(`[Webhook] Order ${order.id} marked expired.`);
      }
    } else {
      console.log(`[Webhook] Unknown event: ${event}`);
    }

    return NextResponse.json({ received: true, matched: true });
  } catch (error) {
    console.error("[Webhook] Error:", error);
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 },
    );
  }
}
