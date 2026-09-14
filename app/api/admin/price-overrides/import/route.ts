import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type Role = 'admin' | 'assistant' | 'affiliate' | 'customer';

async function getCaller(req: NextRequest): Promise<{ id: string | null; role: Role }> {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return { id: null, role: 'customer' };
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return { id: null, role: 'customer' };
  const { data } = await db.from('customers').select('role').eq('id', user.id).single();
  return { id: user.id, role: (data?.role ?? 'customer') as Role };
}

async function affiliateOwnsCustomer(affiliateId: string, customerId: string): Promise<boolean> {
  const { data } = await db
    .from('customers').select('id').eq('id', customerId).eq('affiliate_id', affiliateId).maybeSingle();
  return !!data;
}

function parseDollar(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const n = parseFloat(String(raw).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

// GET /api/admin/price-overrides/import — product catalogue for the template
export async function GET(req: NextRequest) {
  const { role } = await getCaller(req);
  if (!['admin', 'assistant', 'affiliate'].includes(role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { data, error } = await db
    .from('products')
    .select('id, sku, name, price')
    .eq('active', true)
    .order('name');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ products: data ?? [] });
}

// POST /api/admin/price-overrides/import — apply a CSV/XLSX of { SKU|Product, Price }
// to a single customer (multipart: file + customer_id).
export async function POST(req: NextRequest) {
  const { id, role } = await getCaller(req);
  if (!['admin', 'affiliate'].includes(role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const form = await req.formData();
  const file = form.get('file') as File | null;
  const customerId = String(form.get('customer_id') ?? '');
  if (!file) return NextResponse.json({ error: 'A file is required' }, { status: 400 });
  if (!customerId) return NextResponse.json({ error: 'customer_id is required' }, { status: 400 });

  if (role === 'affiliate' && !(await affiliateOwnsCustomer(id!, customerId))) {
    return NextResponse.json({ error: 'You can only price your own customers' }, { status: 403 });
  }

  // Parse (XLSX.read handles both CSV and XLSX buffers).
  let rows: Record<string, any>[];
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: '' });
  } catch {
    return NextResponse.json({ error: 'Could not parse the file. Use the provided template.' }, { status: 400 });
  }

  const { data: products } = await db.from('products').select('id, sku, name').eq('active', true);
  const bySku = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const p of products ?? []) {
    if (p.sku) bySku.set(String(p.sku).trim().toLowerCase(), p.id);
    byName.set(String(p.name).trim().toLowerCase(), p.id);
  }

  const upserts: { customer_id: string; product_id: string; override_price: number }[] = [];
  let matched = 0, skipped = 0;
  for (const row of rows) {
    const sku = String(row['SKU'] ?? row['sku'] ?? '').trim().toLowerCase();
    const name = String(row['Product'] ?? row['Product Name'] ?? row['name'] ?? '').trim().toLowerCase();
    const price = parseDollar(row['Price'] ?? row['Override Price'] ?? row['override_price']);

    const productId = (sku && bySku.get(sku)) || (name && byName.get(name)) || null;
    if (!productId || price == null || price < 0) { skipped++; continue; }
    upserts.push({ customer_id: customerId, product_id: productId, override_price: Math.round(price * 100) / 100 });
    matched++;
  }

  if (upserts.length) {
    const { error } = await db
      .from('customer_price_overrides')
      .upsert(upserts, { onConflict: 'customer_id,product_id' });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, matched, skipped });
}
