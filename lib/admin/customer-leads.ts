/**
 * Lead state for the CRM desks — who claimed someone, how they're being
 * reached, and how the relationship is doing.
 *
 * Lead records live in `customer_leads`, keyed by (EMAIL, SCOPE) rather than by
 * `customers.id`.
 *
 * Email, because everyone who only ever bought through the Stealth Health
 * hosted checkout has no `customers` row at all, and a claim hung off a
 * customer id could never reach them. Email is the one identifier every
 * population has.
 *
 * Scope, because the customer desk and the affiliate desk track genuinely
 * different relationships with the same person. "Hot" on one means ready to
 * buy; on the other it means ready to sell. They get separate claims, statuses,
 * notes and email histories — see affiliate-crm-migration.sql.
 *
 * The constants below are shared with the client (labels, chip colours, the
 * option lists behind the pickers); the server helpers are used by the
 * admin-gated routes with the service-role client.
 */

/** Which desk owns a relationship. */
export type LeadScope = 'customer' | 'affiliate';

export type LeadStatus = 'new' | 'hot' | 'warm' | 'cold' | 'won' | 'lost';

export type ContactMethod =
  | 'email'
  | 'phone'
  | 'sms'
  | 'whatsapp'
  | 'instagram'
  | 'in_person'
  | 'other';

export interface LeadStatusMeta {
  key: LeadStatus;
  label: string;
  /** Chip classes — same vocabulary as the rest of the admin. */
  chip: string;
  /** The solid version, for the selected pill in the status picker. */
  solid: string;
  hint: string;
}

/**
 * Ordered warmest-first, which is the order the status picker shows them in —
 * 'new' sits at the front as the untriaged default.
 */
export const LEAD_STATUSES: LeadStatusMeta[] = [
  {
    key: 'new',
    label: 'New',
    chip: 'bg-gray-500/10 text-ink-muted',
    solid: 'bg-ink text-white',
    hint: 'Not triaged yet',
  },
  {
    key: 'hot',
    label: 'Hot',
    chip: 'bg-red-500/10 text-red-600',
    solid: 'bg-red-600 text-white',
    hint: 'Ready to buy — chase now',
  },
  {
    key: 'warm',
    label: 'Warm',
    chip: 'bg-amber-500/10 text-amber-700',
    solid: 'bg-amber-500 text-white',
    hint: 'Interested, needs nurturing',
  },
  {
    key: 'cold',
    label: 'Cold',
    chip: 'bg-blue-500/10 text-blue-600',
    solid: 'bg-blue-600 text-white',
    hint: 'Gone quiet, low priority',
  },
  {
    key: 'won',
    label: 'Won',
    chip: 'bg-emerald-500/10 text-emerald-600',
    solid: 'bg-emerald-600 text-white',
    hint: 'Converted — buying',
  },
  {
    key: 'lost',
    label: 'Lost',
    chip: 'bg-gray-400/20 text-gray-500',
    solid: 'bg-gray-500 text-white',
    hint: 'Not going anywhere',
  },
];

export const LEAD_STATUS_META: Record<LeadStatus, LeadStatusMeta> = Object.fromEntries(
  LEAD_STATUSES.map((s) => [s.key, s]),
) as Record<LeadStatus, LeadStatusMeta>;

export const CONTACT_METHODS: { key: ContactMethod; label: string }[] = [
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone call' },
  { key: 'sms', label: 'Text / SMS' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'instagram', label: 'Instagram DM' },
  { key: 'in_person', label: 'In person' },
  { key: 'other', label: 'Other' },
];

export const CONTACT_METHOD_LABEL: Record<string, string> = Object.fromEntries(
  CONTACT_METHODS.map((m) => [m.key, m.label]),
);

const STATUS_KEYS = new Set(LEAD_STATUSES.map((s) => s.key));
const METHOD_KEYS = new Set(CONTACT_METHODS.map((m) => m.key));

export const isLeadStatus = (v: unknown): v is LeadStatus =>
  typeof v === 'string' && STATUS_KEYS.has(v as LeadStatus);

export const isContactMethod = (v: unknown): v is ContactMethod =>
  typeof v === 'string' && METHOD_KEYS.has(v as ContactMethod);

/** A lead row as the API hands it to the client. */
export interface Lead {
  email: string;
  scope: LeadScope;
  customer_id: string | null;
  claimed_by_id: string | null;
  claimed_by_email: string | null;
  claimed_by_name: string | null;
  claimed_at: string | null;
  status: LeadStatus;
  contact_method: ContactMethod | null;
  notes: string | null;
  last_contacted_at: string | null;
  next_follow_up_at: string | null;
  updated_by_name: string | null;
  updated_at: string | null;
}

export const LEAD_COLUMNS =
  'id, email, scope, customer_id, claimed_by_id, claimed_by_email, claimed_by_name, ' +
  'claimed_at, status, contact_method, notes, last_contacted_at, ' +
  'next_follow_up_at, updated_by_id, updated_by_name, created_at, updated_at';

/** The shape used wherever no lead row exists yet — an unclaimed, untriaged lead. */
export function emptyLead(
  email: string,
  customerId: string | null = null,
  scope: LeadScope = 'customer',
): Lead {
  return {
    email,
    scope,
    customer_id: customerId,
    claimed_by_id: null,
    claimed_by_email: null,
    claimed_by_name: null,
    claimed_at: null,
    status: 'new',
    contact_method: null,
    notes: null,
    last_contacted_at: null,
    next_follow_up_at: null,
    updated_by_name: null,
    updated_at: null,
  };
}

export function toLead(
  row: Record<string, any> | null | undefined,
  fallbackEmail: string,
  fallbackScope: LeadScope = 'customer',
): Lead {
  if (!row) return emptyLead(fallbackEmail, null, fallbackScope);
  return {
    email: row.email ?? fallbackEmail,
    scope: row.scope === 'affiliate' ? 'affiliate' : 'customer',
    customer_id: row.customer_id ?? null,
    claimed_by_id: row.claimed_by_id ?? null,
    claimed_by_email: row.claimed_by_email ?? null,
    claimed_by_name: row.claimed_by_name ?? null,
    claimed_at: row.claimed_at ?? null,
    status: isLeadStatus(row.status) ? row.status : 'new',
    contact_method: isContactMethod(row.contact_method) ? row.contact_method : null,
    notes: row.notes ?? null,
    last_contacted_at: row.last_contacted_at ?? null,
    next_follow_up_at: row.next_follow_up_at ?? null,
    updated_by_name: row.updated_by_name ?? null,
    updated_at: row.updated_at ?? null,
  };
}

/** True when the error means `customer_leads` isn't there yet (migration not run). */
export function isMissingLeadTable(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; message?: string };
  // 42P01 = undefined_table. PGRST205 = table not in PostgREST's schema cache.
  if (e.code === '42P01' || e.code === 'PGRST205') return true;
  const msg = typeof e.message === 'string' ? e.message : '';
  return /customer_leads/i.test(msg) && /(does not exist|schema cache)/i.test(msg);
}

/* ------------------------------------------------------------------ */
/* Server helpers (service-role client passed in — no I/O of their own) */
/* ------------------------------------------------------------------ */

type Db = {
  from: (table: string) => any;
};

/**
 * Load every lead, keyed by lowercased email.
 *
 * Returns an empty map (never throws) when `customer_leads` isn't there yet, so
 * the customer list still renders before customer-crm-migration.sql is run —
 * it just shows everyone as unclaimed.
 */
export async function fetchLeads(
  db: Db,
  opts: { scope: LeadScope; emails?: string[]; limit?: number },
): Promise<{ leads: Map<string, Lead>; available: boolean }> {
  let query = db
    .from('customer_leads')
    .select(LEAD_COLUMNS)
    .eq('scope', opts.scope)
    .limit(opts.limit ?? 20000);
  if (opts.emails && opts.emails.length > 0) {
    query = query.in('email', opts.emails.map((e) => e.trim().toLowerCase()));
  }

  const { data, error } = await query;
  if (error) {
    if (!isMissingLeadTable(error)) {
      console.error('[customer-leads] read failed:', error.message);
    }
    return { leads: new Map(), available: !isMissingLeadTable(error) };
  }

  const leads = new Map<string, Lead>();
  for (const row of (data ?? []) as Record<string, any>[]) {
    const email = String(row.email ?? '').trim().toLowerCase();
    if (email) leads.set(email, toLead(row, email, opts.scope));
  }
  return { leads, available: true };
}

/** Load one lead by email, or the unclaimed default when there isn't one. */
export async function fetchLead(
  db: Db,
  email: string,
  scope: LeadScope,
): Promise<{ lead: Lead; available: boolean }> {
  const normalized = email.trim().toLowerCase();
  const { data, error } = await db
    .from('customer_leads')
    .select(LEAD_COLUMNS)
    .eq('email', normalized)
    .eq('scope', scope)
    .maybeSingle();

  if (error) {
    if (isMissingLeadTable(error)) {
      return { lead: emptyLead(normalized, null, scope), available: false };
    }
    console.error('[customer-leads] read failed:', error.message);
    return { lead: emptyLead(normalized, null, scope), available: true };
  }
  return { lead: toLead(data, normalized, scope), available: true };
}

/**
 * Create or update the lead for an email within one desk's scope.
 *
 * Upsert on (email, scope) rather than read-then-write: two admins triaging the
 * same person at once would otherwise race, and one of the writes would insert
 * a duplicate row that the unique index rejects.
 */
export async function upsertLead(
  db: Db,
  email: string,
  scope: LeadScope,
  patch: Record<string, unknown>,
): Promise<{ lead: Lead | null; error: string | null; available: boolean }> {
  const normalized = email.trim().toLowerCase();
  const { data, error } = await db
    .from('customer_leads')
    .upsert({ email: normalized, scope, ...patch }, { onConflict: 'email,scope' })
    .select(LEAD_COLUMNS)
    .maybeSingle();

  if (error) {
    if (isMissingLeadTable(error)) {
      return {
        lead: null,
        available: false,
        error:
          'Lead management is not set up on this database yet — run customer-crm-migration.sql, then affiliate-crm-migration.sql.',
      };
    }
    return { lead: null, available: true, error: error.message };
  }
  return { lead: toLead(data, normalized, scope), error: null, available: true };
}
