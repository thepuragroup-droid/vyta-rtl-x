/**
 * Delivery log for the Stealth Health webhook.
 *
 * Every POST to /api/webhooks/stealth-health is written to
 * `puramass_webhook_events` (puramass-webhook-events-migration.sql) with the
 * body as received and the response we returned. Logging is best-effort: a
 * failed insert (table not migrated yet, DB hiccup) is reported to the console
 * and never changes the webhook's response.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type WebhookOutcome =
  | 'matched'
  | 'unmatched'
  | 'deduped'
  | 'bad_signature'
  | 'not_configured'
  | 'unparseable'
  | 'update_failed'
  | 'error';

export interface WebhookLogInput {
  raw: string;
  /** Parsed body, or undefined when it did not parse (or was never parsed). */
  payload?: unknown;
  signatureValid: boolean;
  outcome: WebhookOutcome;
  responseStatus: number;
  responseBody: unknown;
  puramassOrderId?: string | null;
  error?: string | null;
}

// Keep a runaway body from bloating the table.
const MAX_RAW_CHARS = 64 * 1024;

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

function timestamp(v: unknown): string | null {
  const s = str(v);
  return s && !Number.isNaN(Date.parse(s)) ? s : null;
}

/** Build the `puramass_webhook_events` row for one delivery. Pure. */
export function buildWebhookEventRow(input: WebhookLogInput): Record<string, unknown> {
  const parsed =
    input.payload !== null && typeof input.payload === 'object'
      ? (input.payload as Record<string, any>)
      : null;
  const data = parsed?.data && typeof parsed.data === 'object' ? parsed.data : {};
  const order = data?.order ?? parsed?.order ?? data;

  return {
    event_id: str(parsed?.event_id),
    event_type: str(parsed?.event_type),
    partner_reference: str(parsed?.partner_reference),
    transaction_id: str(data?.transaction_id) ?? str(data?.order_id),
    status: str(data?.status),
    currency: str(data?.currency),
    customer_email: str(order?.customer?.email),
    occurred_at: timestamp(data?.occurred_at) ?? timestamp(parsed?.created_at),
    signature_valid: input.signatureValid,
    payload: parsed,
    // The parsed payload already holds everything; keep the raw text only
    // when there is nothing else to look at.
    raw_body: parsed ? null : input.raw.slice(0, MAX_RAW_CHARS),
    puramass_order_id: input.puramassOrderId ?? null,
    outcome: input.outcome,
    response_status: input.responseStatus,
    response_body: input.responseBody ?? null,
    error: input.error ?? null,
  };
}

/** Insert the delivery row. Never throws. */
export async function logWebhookEvent(
  db: SupabaseClient,
  input: WebhookLogInput,
): Promise<void> {
  try {
    const { error } = await db.from('puramass_webhook_events').insert(buildWebhookEventRow(input));
    if (error) console.error('[stealth-health] webhook log insert failed:', error);
  } catch (err) {
    console.error('[stealth-health] webhook log insert threw:', err);
  }
}
