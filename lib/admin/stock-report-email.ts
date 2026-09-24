/**
 * Emailer for the admin Stock Report.
 *
 * The email carries three views of the same data:
 *   - a short HTML body with headline stat tiles (`renderStockReportEmailHtml`)
 *   - a PDF attachment (`renderStockReportPdf`) — print-ready
 *   - a CSV attachment (`renderStockReportCsv`)  — spreadsheet-ready
 *
 * Callable ad-hoc from the "Send now" button or from the pg_cron-driven
 * scheduled route. Never throws — returns a `{ success, error? }` shape and
 * callers decide what to do on failure. It also never stamps a last-sent
 * marker: that is the cron route's job, so a manual send can't shift the
 * schedule.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendMail } from '@/lib/smtp';
import { SITE_URL } from '@/lib/config';
import {
  computeStockReport,
  type StockReport,
  type StockReportFilters,
} from './stock-report';
import { renderStockReportPdf } from './stock-report-pdf';
import { renderStockReportCsv } from './stock-report-csv';

export interface SendStockReportOptions {
  recipients: string[];
  /** Filters applied when generating the report (default: the whole catalog). */
  filters?: StockReportFilters;
  /** Optional subject override. */
  subject?: string;
  /** Origin for the "Open Products in Admin" button. */
  siteUrl?: string;
}

export interface SendStockReportResult {
  success: boolean;
  id?: string;
  error?: string;
  recipients: string[];
  totals: StockReport['totals'] | null;
}

function sanitizeEmails(list: string[]): string[] {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return Array.from(
    new Set(
      list
        .map((r) => (r ?? '').trim().toLowerCase())
        .filter((r) => r.length > 0 && re.test(r)),
    ),
  );
}

/** UTC date stamp used in both attachment filenames. */
function fileStamp(report: StockReport): string {
  return new Date(report.generatedAt).toISOString().slice(0, 10);
}

/**
 * Short email body with headline stat tiles. Deliberately scannable — the
 * per-product breakdown lives in the attachments, so this doesn't need to
 * bloat the inbox preview. Table-based with inline styles only, because mail
 * clients are not browsers.
 *
 * Exported so admin UIs / preview tools can reuse the same markup.
 */
export function renderStockReportEmailHtml(
  report: StockReport,
  opts: { siteUrl?: string } = {},
): string {
  const baseUrl = opts.siteUrl || SITE_URL;
  const generated = new Date(report.generatedAt);
  const stamp = fileStamp(report);

  const tiles: Array<{ label: string; value: string; meta: string; danger?: boolean }> = [
    { label: 'Products', value: String(report.totals.products), meta: `${report.totals.active} active` },
    {
      label: 'Stock On Hand',
      value: String(report.totals.units),
      meta: `${report.totals.lowStock} low · ${report.totals.outOfStock} out`,
    },
    { label: 'On Order', value: String(report.totals.onOrder), meta: 'units inbound' },
    {
      label: 'Need To Order',
      value: String(report.totals.needToOrder),
      meta: `${report.totals.needCount} product${report.totals.needCount === 1 ? '' : 's'}`,
      danger: report.totals.needToOrder > 0,
    },
  ];

  const tileRow = tiles.map((t) => `
        <td style="padding:6px;vertical-align:top;width:25%">
          <div style="border:1px solid #DCE7EB;border-radius:10px;padding:14px">
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#56707F">${t.label}</div>
            <div style="font-size:18px;font-weight:700;color:${t.danger ? '#B91C1C' : '#07203A'};margin-top:4px">${t.value}</div>
            <div style="font-size:11px;color:#56707F;margin-top:2px">${t.meta}</div>
          </div>
        </td>`).join('');

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#07203A">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;margin:0 auto;background:#ffffff">
    <tr><td style="padding:28px 24px;text-align:center;border-bottom:2px solid #07203A">
      <div style="font-size:24px;font-weight:700">STEALTH HEALTH</div>
      <div style="font-size:11px;letter-spacing:0.15em;color:#438B9E;text-transform:uppercase;margin-top:4px">Stock Report</div>
    </td></tr>
    <tr><td style="padding:20px 18px 0;text-align:center;font-size:13px;color:#56707F">
      Generated ${generated.toLocaleString()}
    </td></tr>
    <tr><td style="padding:12px 12px 0">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>${tileRow}</tr></table>
    </td></tr>
    <tr><td style="padding:18px 18px 0">
      <div style="background:#F7FAFB;border:1px solid #DCE7EB;border-radius:10px;padding:16px;text-align:center;font-size:13px;color:#0E3F5F">
        📎 Full Stock Report attached<br />
        <strong>stock-report-${stamp}.pdf</strong> &nbsp;·&nbsp; <strong>stock-report-${stamp}.csv</strong>
      </div>
    </td></tr>
    <tr><td style="padding:22px 18px;text-align:center">
      <a href="${baseUrl}/admin/products"
         style="display:inline-block;background:#07203A;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600">
        Open Products in Admin
      </a>
    </td></tr>
    <tr><td style="background:#F7FAFB;border-top:1px solid #DCE7EB;padding:16px;text-align:center;font-size:11px;color:#6E8898">
      Automated Stock Report from Stealth Health Admin
    </td></tr>
  </table>
</body></html>`;
}

function renderTextBody(report: StockReport): string {
  return [
    'STEALTH HEALTH  ·  Stock Report',
    `Generated ${new Date(report.generatedAt).toLocaleString()}`,
    '',
    `Products: ${report.totals.products}  ·  Active: ${report.totals.active}`,
    `Stock on hand: ${report.totals.units} units ` +
      `(${report.totals.lowStock} low · ${report.totals.outOfStock} out)`,
    `On order: ${report.totals.onOrder} units`,
    `Need to order: ${report.totals.needToOrder} units across ${report.totals.needCount} products`,
    '',
    'The full per-product breakdown is attached as PDF and CSV.',
  ].join('\n');
}

/**
 * Build the stock report and email it with PDF + CSV attachments. Returns
 * cleanly on empty / invalid recipient lists so callers don't need to
 * pre-validate.
 */
export async function sendStockReportEmail(
  db: SupabaseClient,
  opts: SendStockReportOptions,
): Promise<SendStockReportResult> {
  const clean = sanitizeEmails(opts.recipients ?? []);
  if (clean.length === 0) {
    return { success: false, error: 'No valid recipients', recipients: [], totals: null };
  }

  const report = await computeStockReport(db, opts.filters ?? {});
  const stamp = fileStamp(report);

  // The PDF is the point of this email — a body with no breakdown attached
  // would read as a delivered report that isn't one. Abandon rather than send
  // a partial.
  let pdf: Buffer;
  try {
    pdf = await renderStockReportPdf(report);
  } catch (e) {
    console.error('[stock-report] PDF render failed:', e);
    return {
      success: false,
      error: 'Failed to generate report PDF',
      recipients: clean,
      totals: report.totals,
    };
  }

  const attachments: Array<{ filename: string; content: Buffer }> = [
    { filename: `stock-report-${stamp}.pdf`, content: pdf },
  ];
  try {
    attachments.push({
      filename: `stock-report-${stamp}.csv`,
      content: Buffer.from(renderStockReportCsv(report), 'utf8'),
    });
  } catch (e) {
    console.error('[stock-report] CSV render failed:', e);
  }

  const needTail =
    report.totals.needToOrder > 0 ? ` — ${report.totals.needToOrder} units to order` : '';
  const subject =
    opts.subject ?? `Stealth Health Stock Report (${report.totals.products} products${needTail})`;

  const res = await sendMail({
    to: clean,
    subject,
    html: renderStockReportEmailHtml(report, { siteUrl: opts.siteUrl }),
    text: renderTextBody(report),
    attachments,
  });

  return {
    success: res.success,
    id: res.id,
    error: res.error,
    recipients: clean,
    totals: report.totals,
  };
}
