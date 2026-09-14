import { NextRequest, NextResponse } from "next/server";
import { getMetaCortexClient, SupportedCurrency } from "@/lib/metacortex";
import { getSupabase } from "@/lib/supabase";

interface CheckoutItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
}

interface CheckoutRequest {
  items: CheckoutItem[];
  currency: SupportedCurrency;
  email?: string;
  shipping?: Record<string, unknown>;
}

export async function POST(request: NextRequest) {
  try {
    const body: CheckoutRequest = await request.json();
    const { items, currency, email, shipping } = body;

    if (!items || items.length === 0) {
      return NextResponse.json({ error: "No items in cart" }, { status: 400 });
    }
    if (!currency) {
      return NextResponse.json(
        { error: "Payment currency required" },
        { status: 400 },
      );
    }

    const total = items.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0,
    );
    const description = items
      .map((item) => `${item.name} x${item.quantity}`)
      .join(", ");

    // Generate a stable order_number (the AMC-... external id) and persist
    // the order row BEFORE calling MetaCortex so the webhook has something
    // to mutate. We pass the resulting orders.id (UUID) as MetaCortex
    // metadata.order_id so the webhook can look it up directly.
    const orderNumber = `AMC-${Date.now()}-${Math.random()
      .toString(36)
      .substring(2, 8)
      .toUpperCase()}`;

    const db = getSupabase();
    const { data: order, error: orderErr } = await db
      .from("orders")
      .insert({
        order_number: orderNumber,
        items,
        total,
        email: email ?? null,
        shipping_address: shipping ?? null,
        status: "pending",
        source: "metacortex",
      })
      .select("id, order_number")
      .single();

    if (orderErr || !order) {
      console.error("[Checkout] Failed to insert order:", orderErr);
      return NextResponse.json(
        { error: "Failed to create order" },
        { status: 500 },
      );
    }

    // Create invoice via MetaCortex
    const client = getMetaCortexClient();
    const invoice = await client.createInvoice({
      amount: total,
      currency,
      customer_email: email,
      description: `Aminocan Order: ${description}`,
      metadata: {
        order_id: order.id,
        order_number: order.order_number,
        items,
        total,
      },
    });

    // Persist the MetaCortex payment address on the order so admin can see
    // where the funds are headed if anything goes wrong with the webhook.
    await db
      .from("orders")
      .update({
        payment_address: invoice.payment_address ?? null,
        payment_amount_expected: String(invoice.amount ?? total),
        payment_expires_at: invoice.expires_at ?? null,
        crypto: currency,
      })
      .eq("id", order.id);

    return NextResponse.json({
      success: true,
      order_id: order.id,
      order_number: order.order_number,
      invoice: {
        id: invoice.id,
        invoice_number: invoice.invoice_number,
        amount: invoice.amount,
        currency: invoice.currency,
        payment_address: invoice.payment_address,
        payment_url: invoice.payment_url,
        status: invoice.status,
        expires_at: invoice.expires_at,
      },
    });
  } catch (error) {
    console.error("Checkout error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Checkout failed" },
      { status: 500 },
    );
  }
}
