import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { coveredProductsByReport } from '@/lib/admin/lab-results';
import type { LabResult, LabResultWithProducts } from '@/lib/admin/lab-results';

// Public read of the lab reports shown on /lab-results. Service-role client
// (the browser Supabase client ships with an empty anon key in this project;
// all reads go through server routes — mirrors the /api/products pattern).
//
// Only ACTIVE reports are ever returned, so hiding a report in the admin
// instantly removes it from the public site.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function GET() {
  try {
    // The covered-products join is enrichment — a failure there must NOT hide
    // the reports themselves, so it falls back to an empty map rather than
    // failing the whole request.
    const [labRes, coveredMap] = await Promise.all([
      supabase
        .from('lab_results')
        .select('*')
        .eq('active', true)
        .order('report_date', { ascending: false })
        .order('product_name', { ascending: true }),
      coveredProductsByReport(supabase, true).catch((err) => {
        console.error('Covered-products join failed (returning reports anyway):', err);
        return new Map();
      }),
    ]);

    if (labRes.error) {
      return NextResponse.json({ error: labRes.error.message }, { status: 500 });
    }

    const labResults: LabResultWithProducts[] = (labRes.data as LabResult[] ?? []).map((lab) => ({
      ...lab,
      products: coveredMap.get(lab.report_url) ?? [],
    }));

    return NextResponse.json({ labResults });
  } catch (error: any) {
    console.error('Error fetching lab results:', error);
    return NextResponse.json({ error: error?.message ?? 'Internal server error' }, { status: 500 });
  }
}
