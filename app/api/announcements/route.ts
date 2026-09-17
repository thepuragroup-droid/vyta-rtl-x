import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { liveAnnouncements, shapeAnnouncement } from '@/lib/content/announcements';

const db = getSupabase();

/**
 * GET /api/announcements — the banners the storefront should be showing right
 * now. Public, and deliberately narrow: only rows that are enabled AND inside
 * their schedule window ever leave the server, so a draft banner can't be read
 * out of the network tab before it goes live.
 *
 * Never throws: the announcement bar is chrome on every page, and a missing
 * table (migration not run) or a transient DB error must render as "no banner",
 * not as a broken site.
 */
export async function GET() {
  try {
    const { data, error } = await db
      .from('announcements')
      .select('*')
      .eq('enabled', true)
      .order('sort_order', { ascending: true });

    if (error) return NextResponse.json({ announcements: [] });

    const live = liveAnnouncements((data ?? []).map(shapeAnnouncement));
    return NextResponse.json({ announcements: live });
  } catch {
    return NextResponse.json({ announcements: [] });
  }
}
