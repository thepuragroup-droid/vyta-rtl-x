import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { shapeTestimonial } from '@/lib/content/testimonials';

/**
 * The public testimonial feed — the enabled rows, in the order staff put them
 * in. Everything else about a testimonial (writing, disabling, reordering)
 * lives in /api/admin/testimonials.
 *
 * A missing table is an empty feed, not an error: the homepage carousel just
 * does not render, the same as a shop that has not written any quotes yet.
 */

const db = getSupabase();

export async function GET() {
  try {
    const { data, error } = await db
      .from('testimonials')
      .select('*')
      .eq('enabled', true)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false })
      .limit(30);

    if (error) return NextResponse.json({ testimonials: [] });
    return NextResponse.json({ testimonials: (data ?? []).map(shapeTestimonial) });
  } catch {
    return NextResponse.json({ testimonials: [] });
  }
}
