/**
 * Stock Report — CSV renderer.
 *
 * Attached to the Stock Report email alongside the PDF so purchasing can drop
 * the numbers straight into a spreadsheet. Pure function: takes the result of
 * `computeStockReport` and returns a string ready to write out with
 * `text/csv; charset=utf-8`.
 */
import type { StockReport } from './stock-report';

const HEADER = [
  'Product',
  'Strength',
  'Category',
  'Stock',
  'Min Quantity',
  'On Order',
  'Need To Order',
  'Status',
  'Active',
];

/**
 * RFC-4180 quoting: wrap in quotes when the field contains a comma, newline
 * or a double quote; escape embedded quotes by doubling them.
 */
function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /["\,\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function statusOf(stock: number, minQty: number): string {
  if (stock <= 0) return 'Out of stock';
  if (minQty > 0 && stock <= minQty) return 'Low';
  return 'In stock';
}

export function renderStockReportCsv(data: StockReport): string {
  const lines = [HEADER.map(csvCell).join(',')];
  for (const row of data.rows) {
    lines.push([
      row.name,
      row.strength ?? '',
      row.category ?? '',
      row.stock,
      row.minQty,
      row.onOrder,
      row.needToOrder,
      statusOf(row.stock, row.minQty),
      row.active ? 'Yes' : 'No',
    ].map(csvCell).join(','));
  }
  // CRLF line endings and a UTF-8 BOM so Excel opens accented product names
  // correctly instead of mojibake.
  return `﻿${lines.join('\r\n')}\r\n`;
}
