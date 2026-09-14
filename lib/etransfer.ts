// Shared Interac e-Transfer instruction rendering.
//
// Used in two places so both produce identical customer-facing copy from one
// source of truth:
//   1. Automatic send at checkout (/api/orders-email) — fires immediately when
//      a shipment order is placed.
//   2. Manual admin "Send e-Transfer instructions" button
//      (/api/admin/orders/[id]/send-etransfer-instructions) — resend / edit.
//
// Recipient email + security answer are published to every customer in the
// instructions email (they are not secrets), so they fall back to the store
// defaults below when the site_settings columns are empty. Admins can override
// them in Settings.

export const DEFAULT_ETRANSFER_RECIPIENT = "realsupplementsca@proton.me";
export const DEFAULT_ETRANSFER_SECURITY_ANSWER = "canada";

export interface ETransferSettings {
  etransfer_enabled?: boolean | null;
  etransfer_recipient_email?: string | null;
  etransfer_security_question?: string | null;
  etransfer_security_answer_hint?: string | null;
  etransfer_instructions_subject?: string | null;
  etransfer_instructions_body?: string | null;
}

export interface RenderedETransferInstructions {
  enabled: boolean;
  customerName: string;
  recipientEmail: string;
  securityQuestion: string;
  securityAnswerHint: string;
  subject: string;
  body: string;
}

export function renderETransferInstructions(params: {
  orderNumber: string;
  total: number;
  shipping?: { firstName?: string; lastName?: string } | null;
  settings?: ETransferSettings | null;
}): RenderedETransferInstructions {
  const { orderNumber } = params;
  const total = Number(params.total) || 0;
  const shipping = params.shipping ?? {};
  const cfg = params.settings ?? {};

  const customerName =
    [shipping.firstName, shipping.lastName].filter(Boolean).join(" ").trim() ||
    "there";

  const recipientEmail =
    String(cfg.etransfer_recipient_email ?? "").trim() ||
    DEFAULT_ETRANSFER_RECIPIENT;
  const securityAnswerHint =
    String(cfg.etransfer_security_answer_hint ?? "").trim() ||
    DEFAULT_ETRANSFER_SECURITY_ANSWER;
  const securityQuestion = String(cfg.etransfer_security_question ?? "").trim();

  // Template substitution for the admin-editable site_settings template.
  function render(tmpl: string | null | undefined): string {
    return String(tmpl ?? "").replace(/\{\{(\w+)\}\}/g, (_, key) => {
      switch (key) {
        case "customer_first_name":
          return shipping.firstName ?? "";
        case "customer_last_name":
          return shipping.lastName ?? "";
        case "order_number":
          return orderNumber;
        case "total":
          return `$${total.toFixed(2)} CAD`;
        case "etransfer_recipient_email":
          return recipientEmail;
        case "etransfer_security_question":
          return securityQuestion;
        case "etransfer_security_answer_hint":
          return securityAnswerHint;
        default:
          return "";
      }
    });
  }

  // Built-in step-by-step walkthrough used when the site_settings template
  // columns are empty — so the message is never blank for stores that never
  // customised the copy.
  const fallbackSubject = `Payment instructions for order ${orderNumber}`;
  const fallbackBody = `Hi ${customerName},

Thank you for your order ${orderNumber}. Please complete payment by Interac e-Transfer using the steps below:

1. Log in to your online banking and choose "Send an Interac e-Transfer".
2. Send to: ${recipientEmail}
3. Amount: $${total.toFixed(2)} CAD
4. Set the security answer to: ${securityAnswerHint}${
    securityQuestion
      ? `\n   (Security question: ${securityQuestion})`
      : `\n   (If your bank asks for a security question, you can use any question — only the answer above matters.)`
  }
5. In the message/memo field, include your order number: ${orderNumber}

Once we receive your transfer we'll confirm and begin fulfilling your order. Orders are sent out 1 business day after payment is received.

Thank you,
VYTA`;

  const renderedSubject = render(cfg.etransfer_instructions_subject).trim();
  const renderedBody = render(cfg.etransfer_instructions_body).trim();

  return {
    // Only an explicit `false` disables the flow; a missing row leaves it on.
    enabled: cfg.etransfer_enabled !== false,
    customerName,
    recipientEmail,
    securityQuestion,
    securityAnswerHint,
    subject: renderedSubject || fallbackSubject,
    body: renderedBody || fallbackBody,
  };
}
