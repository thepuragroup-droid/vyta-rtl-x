import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { canAccessAdmin, type UserRole } from '@/lib/permissions';
import {
  ERROR_CATEGORIES,
  getEmailFailures,
  summarize,
  type ErrorLogEntry,
} from '@/lib/admin/error-log';

async function verifyAdmin(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return { ok: false };
  const db = getSupabase();
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return { ok: false };
  const { data } = await db.from('customers').select('role').eq('id', user.id).single();
  const role = (data?.role ?? 'customer') as UserRole;
  // Analytics partners can enter /admin but must not read the error log.
  return { ok: canAccessAdmin(role) && role !== 'analytics' };
}

// GET /api/admin/error-log?limit=500
// Returns tracked errors across categories. Today the only category is
// `order_email` (failed transactional email sends), surfaced from the existing
// email log tables so nothing is lost when a background send fails.
export async function GET(req: NextRequest) {
  const { ok } = await verifyAdmin(req);
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const limitRaw = req.nextUrl.searchParams.get('limit');
  const parsed = limitRaw ? parseInt(limitRaw, 10) : 500;
  const limit = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 1000) : 500;

  let entries: ErrorLogEntry[] = [];
  try {
    entries = await getEmailFailures(limit);
  } catch (e) {
    console.error('error-log GET failed:', e);
    return NextResponse.json({ error: 'Failed to load error log' }, { status: 500 });
  }

  const summaries = ERROR_CATEGORIES.map((c) => summarize(entries, c.id));

  return NextResponse.json({
    categories: ERROR_CATEGORIES,
    summaries,
    entries,
  });
}
