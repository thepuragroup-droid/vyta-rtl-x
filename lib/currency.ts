// Currency support for invoices and customer billing.
//
// The business runs in CAD by default but also bills some customers in USD.
// A customer carries a `preferred_currency`; invoices carry a `currency` that
// defaults to the linked customer's preference.

export type Currency = 'CAD' | 'USD';

export const CURRENCIES: Currency[] = ['CAD', 'USD'];

export const DEFAULT_CURRENCY: Currency = 'CAD';

/** Narrow an untrusted value to a supported currency, falling back to CAD. */
export function normalizeCurrency(value: unknown): Currency {
  return value === 'USD' ? 'USD' : 'CAD';
}

const LOCALE: Record<Currency, string> = { CAD: 'en-CA', USD: 'en-US' };

/** Format an amount in the given currency, e.g. formatMoney(10, 'USD') → "US$10.00". */
export function formatMoney(amount: number, currency: Currency = DEFAULT_CURRENCY): string {
  return new Intl.NumberFormat(LOCALE[currency], {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
  }).format(Number(amount) || 0);
}

/**
 * Compact money for chart axis ticks — "$1.2K", "US$340". Uses the same locale
 * and symbol as formatMoney so a tick never disagrees with the value beside it.
 */
export function formatMoneyCompact(amount: number, currency: Currency = DEFAULT_CURRENCY): string {
  return new Intl.NumberFormat(LOCALE[currency], {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    notation: 'compact',
    // Two digits so a mid-axis tick like 1,250 renders as "$1.25K" rather than
    // a rounded "$1.3K" that disagrees with the gridline it labels.
    maximumFractionDigits: 2,
  }).format(Number(amount) || 0);
}

/** Short label for a currency, e.g. "CAD $" / "USD $". */
export function currencyLabel(currency: Currency): string {
  return `${currency} $`;
}
