import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyLabResultsAccess, sanitizeLabResult } from '@/lib/admin/lab-results';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// PATCH /api/admin/lab-results/[id] — edit a report, or toggle its visibility
// with { active: boolean }. Requires mutation access (admin).
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { authorized } = await verifyLabResultsAccess(supabase, request, true);
  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized - Admin role required' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const patch = sanitizeLabResult(body);

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    // Guard against blanking the required columns.
    if ('report_url' in patch && !patch.report_url) {
      return NextResponse.json({ error: 'report_url cannot be empty' }, { status: 400 });
    }
    if ('product_name' in patch && !patch.product_name) {
      return NextResponse.json({ error: 'product_name cannot be empty' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('lab_results')
      .update(patch)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'A report with this URL already exists' },
          { status: 409 },
        );
      }
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Lab result not found' }, { status: 404 });
      }
      console.error('Error updating lab result:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ error: 'Lab result not found' }, { status: 404 });
    }

    return NextResponse.json({ labResult: data });
  } catch (error: any) {
    console.error('Unexpected error updating lab result:', error);
    return NextResponse.json({ error: error?.message ?? 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/admin/lab-results/[id] — remove a report. Requires mutation access.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { authorized } = await verifyLabResultsAccess(supabase, request, true);
  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized - Admin role required' }, { status: 403 });
  }

  try {
    const { error } = await supabase.from('lab_results').delete().eq('id', id);

    if (error) {
      console.error('Error deleting lab result:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Unexpected error deleting lab result:', error);
    return NextResponse.json({ error: error?.message ?? 'Internal server error' }, { status: 500 });
  }
}
