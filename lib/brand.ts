/**
 * Site brand for documents we send to partners (the Stealth Health payout
 * request PDF). The same module runs on all four sites; this file is the only
 * part of it that differs between them.
 */
export const BRAND = {
  name: 'VYTA Biosciences',     // "From" block, PDF metadata
  wordmark: 'VYTA',             // large wordmark at the top of the PDF
  website: 'vytabio.com',
  email: 'support@vytabio.com',
  accent: '#1B5D83',            // Vital Blue: PDF title, table rule, "Net payout due" bar
  payoutPrefix: 'VY',           // → VY-PAY-2026-0001; unique per site
  timeZone: 'America/New_York', // dates on the PDF (rendered on the UTC server)
} as const;
