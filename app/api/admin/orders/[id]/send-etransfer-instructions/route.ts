import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendETransferInstructions } from "@/lib/email";
import { renderETransferInstructions } from "@/lib/etransfer";
import { logAuditServer } from "@/lib/admin/audit";

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function verifyAdmin(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return { ok: false, userId: null as string | null, email: null as string | null };
  const {
    data: { user },
  } = await db.auth.getUser(token);
  if (!user) return { ok: false, userId: null, email: null };
  const { data } = await db
    .from("customers")
    .select("role, email")
    .eq("id", user.id)
    .single();
  return {
    ok: data?.role === "admin" || data?.role === "assistant",
    userId: user.id,
    email: data?.email ?? user.email ?? null,
  };
}

// Shared: load the order + rendered e-Transfer template so both the preview
// (GET) and the send (POST) work from the exact same rendered defaults.
async function loadOrderAndTemplate(id: string) {
  const { data: order } = await db
    .from("orders")
    .select("id, order_number, email, total, shipping_address")
    .eq("id", id)
    .maybeSingle();
  if (!order) {
    return { error: "Order not found" as const, status: 404 };
  }

  const { data: settings } = await db
    .from("site_settings")
    .select(
      "etransfer_enabled, etransfer_recipient_email, etransfer_security_question, etransfer_security_answer_hint, etransfer_instructions_subject, etransfer_instructions_body",
    )
    .limit(1)
    .maybeSingle();

  const rendered = renderETransferInstructions({
    orderNumber: order.order_number,
    total: Number(order.total) || 0,
    shipping: (order.shipping_address as any) ?? {},
    settings,
  });

  // Only refuse if e-Transfer is *explicitly* disabled. A missing recipient
  // email no longer blocks the flow — the admin previews the message and can
  // fill in the recipient / security details directly in the editable modal.
  if (!rendered.enabled) {
    return { error: "e-Transfer is disabled in site settings" as const, status: 400 };
  }

  return {
    order,
    customerName: rendered.customerName,
    total: Number(order.total) || 0,
    recipientEmail: rendered.recipientEmail,
    securityQuestion: rendered.securityQuestion,
    securityAnswerHint: rendered.securityAnswerHint,
    defaultSubject: rendered.subject,
    defaultBody: rendered.body,
  };
}

// GET /api/admin/orders/[id]/send-etransfer-instructions
//   Returns the rendered template + defaults so the admin can preview,
//   confirm, and edit the message before it is sent. Admin-only.
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const { ok } = await verifyAdmin(req);
  if (!ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const loaded = await loadOrderAndTemplate(params.id);
  if ("error" in loaded) {
    return NextResponse.json({ error: loaded.error }, { status: loaded.status });
  }

  return NextResponse.json({
    to: loaded.order.email ?? "",
    subject: loaded.defaultSubject,
    body: loaded.defaultBody,
    order_number: loaded.order.order_number,
    total: loaded.total,
    recipient_email: loaded.recipientEmail,
  });
}

// POST /api/admin/orders/[id]/send-etransfer-instructions
//   body: { to?, cc?, subject?, body?, attachments? }
//     - all optional; defaults come from site_settings
//     - cc: string | string[] (comma-separated string also accepted)
//     - attachments: [{ filename, content }] where content is base64
//
// Renders the e-Transfer instructions template from site_settings, sends
// it to the customer, and logs to fulfillment_email_log. Admin-only.
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const { ok, userId, email: actorEmail } = await verifyAdmin(req);
  if (!ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  let body: {
    to?: string;
    cc?: string | string[];
    subject?: string;
    body?: string;
    attachments?: Array<{ filename?: string; content?: string }>;
  };
  try {
    body = await req.json().catch(() => ({}));
  } catch {
    body = {};
  }

  const loaded = await loadOrderAndTemplate(params.id);
  if ("error" in loaded) {
    return NextResponse.json({ error: loaded.error }, { status: loaded.status });
  }
  const {
    order,
    customerName,
    total,
    recipientEmail,
    securityQuestion,
    securityAnswerHint,
    defaultSubject,
    defaultBody,
  } = loaded;

  const customerEmail = body.to ?? order.email;
  if (!customerEmail) {
    return NextResponse.json(
      { error: "Order has no customer email; provide `to`" },
      { status: 400 },
    );
  }

  // Normalize CC: accept an array or a comma/semicolon/whitespace-separated
  // string; drop empties so we never send an empty CC header.
  const ccList = (Array.isArray(body.cc) ? body.cc : String(body.cc ?? "").split(/[,;\s]+/))
    .map((s) => s.trim())
    .filter(Boolean);

  // Decode base64 image attachments into Buffers.
  const attachments = (body.attachments ?? [])
    .filter((a) => a && a.filename && a.content)
    .map((a) => ({
      filename: String(a.filename),
      content: Buffer.from(
        String(a.content).replace(/^data:[^;]+;base64,/, ""),
        "base64",
      ),
    }));

  const customSubject = body.subject ?? defaultSubject;
  const customBodyText = body.body ?? defaultBody;

  const result = await sendETransferInstructions({
    to: customerEmail,
    cc: ccList.length ? ccList : undefined,
    customerName,
    orderNumber: order.order_number,
    total,
    recipientEmail,
    securityQuestion,
    securityAnswerHint,
    customSubject: customSubject || undefined,
    customBodyText: customBodyText || undefined,
    attachments: attachments.length ? attachments : undefined,
  });

  try {
    await db.from("fulfillment_email_log").insert({
      order_id: order.id,
      kind: "etransfer_instructions",
      to_email: customerEmail,
      subject: result.subject ?? null,
      message_id: result.messageId ?? null,
      success: result.success,
      error: result.success ? null : (result as any).error ?? null,
      sent_by: userId,
      sent_by_email: actorEmail,
    });
  } catch (e) {
    console.error("etransfer_instructions log insert failed:", e);
  }

  if (!result.success) {
    return NextResponse.json(
      { success: false, error: (result as any).error ?? "send failed" },
      { status: 500 },
    );
  }

  await logAuditServer(
    db,
    { actor_id: userId, actor_email: actorEmail },
    {
      action: "order.etransfer_instructions_sent",
      entity_type: "order",
      entity_id: order.id,
    },
  );

  return NextResponse.json({
    success: true,
    message_id: result.messageId ?? null,
    sent_to: customerEmail,
  });
}
