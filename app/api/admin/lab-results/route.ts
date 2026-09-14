import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  verifyLabResultsAccess,
  sanitizeLabResult,
  coveredProductsByReport,
} from '@/lib/admin/lab-results';
import type { LabResult, LabResultWithProducts } from '@/lib/admin/lab-results';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// GET /api/admin/lab-results — every report (active + hidden) with its covered
// products. Requires read access (admin or assistant).
export async function GET(request: NextRequest) {
  const { authorized } = await verifyLabResultsAccess(supabase, request);
  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  try {
    const [labRes, coveredMap] = await Promise.all([
      supabase
        .from('lab_results')
        .select('*')
        .order('report_date', { ascending: false })
        .order('product_name', { ascending: true }),
      coveredProductsByReport(supabase, false).catch((err) => {
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
    console.error('Error fetching admin lab results:', error);
    return NextResponse.json({ error: error?.message ?? 'Internal server error' }, { status: 500 });
  }
}

// POST /api/admin/lab-results — create a report. Requires mutation access (admin).
export async function POST(request: NextRequest) {
  const { authorized } = await verifyLabResultsAccess(supabase, request, true);
  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized - Admin role required' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const patch = sanitizeLabResult(body);

    if (!patch.report_url || !patch.product_name) {
      return NextResponse.json(
        { error: 'report_url and product_name are required' },
        { status: 400 },
      );
    }

    const { data, error } = await supabase
      .from('lab_results')
      .insert(patch)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'A report with this URL already exists' },
          { status: 409 },
        );
      }
      console.error('Error creating lab result:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ labResult: data }, { status: 201 });
  } catch (error: any) {
    console.error('Unexpected error creating lab result:', error);
    return NextResponse.json({ error: error?.message ?? 'Internal server error' }, { status: 500 });
  }
}
