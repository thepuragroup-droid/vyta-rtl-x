/**
 * Phone-number check shared by the checkout form and the checkout API, so the
 * browser and the server agree on what counts as a usable number.
 *
 * Deliberately loose on format — spaces, dashes, dots, brackets and a leading
 * "+" are all fine — and strict only on length: 10 to 15 digits covers a North
 * American number (with or without the leading 1) and any E.164 number.
 */
export function phoneDigits(phone: string): string {
  return String(phone ?? '').replace(/\D/g, '');
}

export function isValidPhone(phone: string): boolean {
  const raw = String(phone ?? '').trim();
  if (!/^\+?[\d\s().-]+$/.test(raw)) return false;
  const digits = phoneDigits(raw);
  return digits.length >= 10 && digits.length <= 15;
}
