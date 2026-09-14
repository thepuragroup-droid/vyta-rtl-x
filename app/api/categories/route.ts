import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

const db = getSupabase();

// GET /api/categories — public storefront category list.
// Only active categories, ordered by sort_order then name.
// `?featured=1` narrows to the homepage grid.
export async function GET(request: NextRequest) {
  const featured = request.nextUrl.searchParams.get('featured');

  let query = db
    .from('store_categories')
    .select('*')
    .eq('active', true)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (featured === '1' || featured === 'true') {
    query = query.eq('featured', true);
  }

  const { data, error } = await query;

  if (error) {
    // Un-migrated DB (table absent) or any read failure — return an empty
    // list so the storefront falls back to its built-in categories.
    return NextResponse.json({ categories: [] });
  }

  return NextResponse.json({ categories: data ?? [] });
}
