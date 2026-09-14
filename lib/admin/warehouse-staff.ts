// Admin tools for managing warehouse staff: accounts, performance, activity.
// Performance is derived from audit_logs rows with action like
// 'invoice.fulfillment_update.<status>' (state-in-action encoding;
// audit_logs has no payload column — see docs/admin-audit-log.md).

import { getSupabase } from '@/lib/supabase';

export interface WarehouseStaffAccount {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  active: boolean;
  can_send_fulfillment_emails: boolean;
  last_login_at: string | null;
}

export interface StaffPerformance {
  actor_id: string;
  actor_email: string | null;
  display_name: string;
  packed: number;
  shipped: number;
  picked_up: number;
  completed: number;
  completed_today: number;
  last_active: string | null;
}

export interface WarehouseActivityEvent {
  id: string;
  created_at: string;
  action: string;
  to_status: string | null;
  actor_id: string | null;
  actor_email: string | null;
  invoice_id: string | null;
  invoice_number: string | null;
  order_number: string | null;
}

export interface WarehouseActivity {
  accounts: WarehouseStaffAccount[];
  performance: StaffPerformance[];
  logs: WarehouseActivityEvent[];
}

function todayStartIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function suffix(action: string): string | null {
  const i = action.lastIndexOf('.');
  if (i < 0) return null;
  return action.slice(i + 1);
}

export async function getWarehouseActivity(): Promise<WarehouseActivity> {
  const db = getSupabase();

  // 1. Warehouse accounts.
  const { data: accountsRaw } = await db
    .from('customers')
    .select(
      'id, email, first_name, last_name, active, can_send_fulfillment_emails, last_login_at',
    )
    .eq('role', 'warehouse')
    .order('first_name', { ascending: true });
  const accounts: WarehouseStaffAccount[] = (accountsRaw ?? []) as any;
  const warehouseIds = new Set(accounts.map((a) => a.id));

  // 2. Recent fulfillment-update audit rows.
  const { data: rows } = await db
    .from('audit_logs')
    .select('id, created_at, action, actor_id, actor_email, entity_id, entity_type')
    .like('action', 'invoice.fulfillment_update.%')
    .order('created_at', { ascending: false })
    .limit(500);

  const auditRows = (rows ?? []) as any[];

  // 3. Per-actor performance (warehouse actors only).
  const todayStart = todayStartIso();
  const perfMap = new Map<string, StaffPerformance>();
  for (const r of auditRows) {
    if (!r.actor_id || !warehouseIds.has(r.actor_id)) continue;
    const s = suffix(r.action);
    if (!s) continue;
    if (!perfMap.has(r.actor_id)) {
      const acc = accounts.find((a) => a.id === r.actor_id);
      perfMap.set(r.actor_id, {
        actor_id: r.actor_id,
        actor_email: r.actor_email ?? acc?.email ?? null,
        display_name:
          [acc?.first_name, acc?.last_name].filter(Boolean).join(' ') ||
          acc?.email ||
          r.actor_email ||
          'Warehouse',
        packed: 0,
        shipped: 0,
        picked_up: 0,
        completed: 0,
        completed_today: 0,
        last_active: r.created_at,
      });
    }
    const p = perfMap.get(r.actor_id)!;
    if (!p.last_active || r.created_at > p.last_active) p.last_active = r.created_at;
    if (s === 'packed') p.packed++;
    else if (s === 'shipped') {
      p.shipped++;
      p.completed++;
      if (r.created_at >= todayStart) p.completed_today++;
    } else if (s === 'picked_up') {
      p.picked_up++;
      p.completed++;
      if (r.created_at >= todayStart) p.completed_today++;
    }
  }

  // Always include accounts with no events too.
  for (const a of accounts) {
    if (!perfMap.has(a.id)) {
      perfMap.set(a.id, {
        actor_id: a.id,
        actor_email: a.email,
        display_name:
          [a.first_name, a.last_name].filter(Boolean).join(' ') || a.email,
        packed: 0,
        shipped: 0,
        picked_up: 0,
        completed: 0,
        completed_today: 0,
        last_active: null,
      });
    }
  }

  // 4. Recent activity feed (60 newest), resolving invoice/order numbers.
  const feed = auditRows.slice(0, 60);
  const invoiceIds = [...new Set(feed.map((r) => r.entity_id).filter(Boolean))];
  let invoiceMap: Record<string, { invoice_number: string; order_number: string | null }> = {};
  if (invoiceIds.length > 0) {
    const { data: invs } = await db
      .from('invoices')
      .select('id, invoice_number, order:orders(order_number)')
      .in('id', invoiceIds);
    invoiceMap = Object.fromEntries(
      (invs ?? []).map((v: any) => [
        v.id,
        {
          invoice_number: v.invoice_number,
          order_number: v.order?.order_number ?? null,
        },
      ]),
    );
  }

  const logs: WarehouseActivityEvent[] = feed.map((r) => {
    const inv = r.entity_id ? invoiceMap[r.entity_id] : undefined;
    return {
      id: r.id,
      created_at: r.created_at,
      action: r.action,
      to_status: suffix(r.action),
      actor_id: r.actor_id,
      actor_email: r.actor_email,
      invoice_id: r.entity_id ?? null,
      invoice_number: inv?.invoice_number ?? null,
      order_number: inv?.order_number ?? null,
    };
  });

  const performance = [...perfMap.values()].sort(
    (a, b) => b.completed - a.completed,
  );

  return { accounts, performance, logs };
}

export async function setWarehouseEmailPermission(
  userId: string,
  canSend: boolean,
): Promise<void> {
  const db = getSupabase();
  const { error } = await db
    .from('customers')
    .update({ can_send_fulfillment_emails: canSend })
    .eq('id', userId);
  if (error) throw new Error(error.message);
}
