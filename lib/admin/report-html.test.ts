/**
 * Tests for the shared report shell.
 *
 *   node --test --import tsx lib/admin/report-html.test.ts
 *
 * The property most worth pinning is the print CSS: `print-color-adjust:
 * exact` is what makes the branded layout survive the print dialog on the
 * defaults. Without it the black table header prints white-on-white and the
 * column headings vanish — a failure that is invisible until someone prints.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  escapeHtml, money, formatDate, formatStockDisplay,
  statsGrid, table, pill, reportShell,
} from './report-html';

test('backgrounds are forced to print', () => {
  const html = reportShell({ title: 'T', body: '' });
  assert.ok(html.includes('print-color-adjust: exact'), 'the standard property');
  assert.ok(html.includes('-webkit-print-color-adjust: exact'), 'Blink/WebKit');
  assert.ok(html.includes('color-adjust: exact'), 'the Firefox 63–96 alias');
  // The fallback for engines that know none of the three: ink on white with a
  // gold rule beats invisible white text.
  assert.ok(html.includes('@supports not ((-webkit-print-color-adjust: exact)'));
});

test('auto-print is on by default and omitted on request', () => {
  assert.ok(reportShell({ title: 'T', body: '' }).includes('window.print()'));
  assert.ok(!reportShell({ title: 'T', body: '', autoPrint: false }).includes('window.print()'));
});

test('the branded variant carries the wordmark, meta line and confidential footer', () => {
  const html = reportShell({
    title: 'Products Report', body: '<p>x</p>', branded: true,
    meta: ['Generated now', '3 products'], footRight: '3 products',
  });
  assert.ok(html.includes('class="branded"'));
  assert.ok(html.includes('>STEALTH HEALTH<'));
  assert.ok(html.includes('class="goldrule"'));
  assert.ok(html.includes('<span>Generated now</span><span>3 products</span>'));
  assert.ok(html.includes('Confidential — internal use only'));
});

test('the unbranded variant keeps the plain heading', () => {
  const html = reportShell({ title: 'Customers', body: '' });
  assert.ok(!html.includes('class="branded"'));
  // The branded rules live in the shared stylesheet either way; what must be
  // absent is the brand markup.
  assert.ok(!html.includes('<div class="brandhead">'));
  assert.ok(html.includes('<h1>Customers</h1>'));
  assert.ok(html.includes('Stealth Health · Generated'));
});

test('titles and filter chips are escaped', () => {
  const html = reportShell({
    title: '<script>alert(1)</script>',
    filters: ['Search: "<b>x</b>"'],
    body: '',
  });
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&lt;b&gt;x&lt;/b&gt;'));
});

test('escapeHtml covers the four characters that break attributes and tags', () => {
  assert.equal(escapeHtml('& < > "'), '&amp; &lt; &gt; &quot;');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
});

test('money always prints a bare dollar sign to two places', () => {
  assert.equal(money(0), '$0.00');
  assert.equal(money(12.5), '$12.50');
  assert.equal(money(Number.NaN), '$0.00', 'a broken figure prints as zero, not "$NaN"');
});

test('formatDate degrades to an em dash', () => {
  assert.equal(formatDate(null), '—');
  assert.equal(formatDate('not a date'), '—');
});

test('formatStockDisplay never prints "0 boxes" for real stock', () => {
  assert.equal(formatStockDisplay(240, 10, 'vials'), '240 vials');
  assert.equal(formatStockDisplay(1, 10, 'vials'), '1 vial');
  assert.equal(formatStockDisplay(243, 10, 'boxes'), '24 boxes (3 vials)');
  assert.equal(formatStockDisplay(243, 10, 'boxes', false), '24 boxes');
  assert.equal(formatStockDisplay(240, 10, 'boxes'), '24 boxes', 'no remainder to show');
  assert.equal(formatStockDisplay(10, 10, 'boxes'), '1 box', 'singular');
  // 7 vials is real stock. "0 boxes" would read as nothing on hand.
  assert.equal(formatStockDisplay(7, 10, 'boxes'), '7 vials');
  assert.equal(formatStockDisplay(10, 0, 'boxes'), '1 box', 'vials_per_box 0 falls back to 10');
  assert.equal(formatStockDisplay(0, 10, 'boxes'), '0 vials');
});

test('statsGrid gives 1–4 equal columns', () => {
  assert.equal(statsGrid([]), '', 'nothing to show');
  assert.ok(statsGrid([{ label: 'a', value: '1' }]).includes('repeat(1, 1fr)'));
  assert.ok(statsGrid(Array(3).fill({ label: 'a', value: '1' })).includes('repeat(3, 1fr)'));
  assert.ok(statsGrid(Array(7).fill({ label: 'a', value: '1' })).includes('repeat(4, 1fr)'), 'clamped');
});

test('a stat tone becomes a class, and "default" adds none', () => {
  assert.ok(statsGrid([{ label: 'a', value: '1', tone: 'danger' }]).includes('class="stat danger"'));
  assert.ok(statsGrid([{ label: 'a', value: '1', tone: 'default' }]).includes('class="stat"'));
});

test('an empty table renders one full-width empty state', () => {
  const html = table([{ header: 'A' }, { header: 'B', num: true }], [], 'Nothing here.');
  assert.ok(html.includes('colspan="2"'));
  assert.ok(html.includes('Nothing here.'));
  assert.ok(html.includes('<th class="num">B</th>'));
});

test('table cells are raw HTML so callers can embed pills', () => {
  const html = table([{ header: 'A' }], [[pill('Active', 'green')]], 'empty');
  assert.ok(html.includes('<span class="pill green">Active</span>'));
});

test('numeric alignment follows the column, not the cell', () => {
  const html = table([{ header: 'A' }, { header: 'B', num: true }], [['1', '2']], 'empty');
  assert.ok(html.includes('<td>1</td><td class="num">2</td>'));
});
