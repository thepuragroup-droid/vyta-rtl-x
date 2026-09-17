import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { shapeSitePage } from '@/lib/content/pages';

const db = getSupabase();

/**
 * GET /api/site-pages/[slug] — one PUBLISHED marketing page.
 *
 * Unpublished pages 404 here: `published` is the storefront toggle, and an
 * editor's draft must not be readable from the public API just because its URL
 * is guessable.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  try {
    const { data, error } = await db
      .from('site_pages')
      .select('*')
      .eq('slug', slug)
      .eq('published', true)
      .maybeSingle();

    if (error || !data) {
      return NextResponse.json({ error: 'Page not found' }, { status: 404 });
    }
    return NextResponse.json({ page: shapeSitePage(data) });
  } catch {
    return NextResponse.json({ error: 'Page not found' }, { status: 404 });
  }
}
