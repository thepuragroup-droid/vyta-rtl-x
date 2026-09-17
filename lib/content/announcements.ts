/**
 * The sticky site-wide announcement bar.
 *
 * Rows live in `announcements` (see pack-options-content-migration.sql). The
 * storefront shows every row that is `enabled` and inside its optional
 * start/end window; `enabled` IS the admin panel's "show on storefront"
 * toggle, so switching a banner off never requires deleting it.
 */

export type AnnouncementTheme = 'brand' | 'navy' | 'teal' | 'amber' | 'emerald' | 'custom';

export interface Announcement {
  id: string;
  message: string;
  link_url: string | null;
  link_label: string | null;
  theme: AnnouncementTheme;
  bg_color: string | null;
  text_color: string | null;
  scrolling: boolean;
  speed_seconds: number;
  dismissible: boolean;
  /** The storefront toggle. */
  enabled: boolean;
  sort_order: number;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Ready-made colour pairs, so a banner looks on-brand without a colour picker. */
export const ANNOUNCEMENT_THEMES: Array<{
  key: AnnouncementTheme;
  label: string;
  background: string;
  color: string;
}> = [
  { key: 'brand',   label: 'Brand gradient', background: 'linear-gradient(90deg, #07203A 0%, #1B5D83 55%, #438B9E 100%)', color: '#FFFFFF' },
  { key: 'navy',    label: 'Midnight navy',  background: '#07203A', color: '#FFFFFF' },
  { key: 'teal',    label: 'Bio teal',       background: '#438B9E', color: '#FFFFFF' },
  { key: 'amber',   label: 'Amber',          background: '#B45309', color: '#FFFFFF' },
  { key: 'emerald', label: 'Emerald',        background: '#047857', color: '#FFFFFF' },
  { key: 'custom',  label: 'Custom colours', background: '#07203A', color: '#FFFFFF' },
];

const THEME_KEYS = new Set(ANNOUNCEMENT_THEMES.map((t) => t.key));

/** The CSS a banner renders with — preset pair, or the row's own colours. */
export function announcementStyle(a: Announcement): { background: string; color: string } {
  if (a.theme === 'custom') {
    return {
      background: a.bg_color || '#07203A',
      color: a.text_color || '#FFFFFF',
    };
  }
  const preset = ANNOUNCEMENT_THEMES.find((t) => t.key === a.theme) ?? ANNOUNCEMENT_THEMES[0];
  return { background: preset.background, color: preset.color };
}

function cleanString(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Normalise a raw DB row; every field is defaulted so the bar can't crash. */
export function shapeAnnouncement(row: Record<string, any>): Announcement {
  const speed = Number(row.speed_seconds);
  const theme = typeof row.theme === 'string' && THEME_KEYS.has(row.theme as AnnouncementTheme)
    ? (row.theme as AnnouncementTheme)
    : 'brand';
  return {
    id: String(row.id),
    message: String(row.message ?? ''),
    link_url: cleanString(row.link_url),
    link_label: cleanString(row.link_label),
    theme,
    bg_color: cleanString(row.bg_color),
    text_color: cleanString(row.text_color),
    scrolling: row.scrolling === true,
    // Clamp so a bad value can't produce a stalled or seizure-fast marquee.
    speed_seconds: Number.isFinite(speed) ? Math.min(120, Math.max(6, Math.round(speed))) : 24,
    dismissible: row.dismissible === true,
    enabled: row.enabled === true,
    sort_order: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : 0,
    starts_at: cleanString(row.starts_at),
    ends_at: cleanString(row.ends_at),
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
  };
}

/**
 * Is this banner live right now? `enabled` plus the optional schedule window.
 * Evaluated on the server for the public feed and again in the admin list, so
 * both agree on what "Live" means.
 */
export function isAnnouncementLive(a: Announcement, now: Date = new Date()): boolean {
  if (!a.enabled) return false;
  if (a.starts_at && new Date(a.starts_at).getTime() > now.getTime()) return false;
  if (a.ends_at && new Date(a.ends_at).getTime() < now.getTime()) return false;
  return true;
}

/** Live banners, in display order. */
export function liveAnnouncements(rows: Announcement[], now: Date = new Date()): Announcement[] {
  return rows
    .filter((a) => a.message.trim().length > 0 && isAnnouncementLive(a, now))
    .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));
}

/** Shared field coercion for create and update. */
export function announcementPatch(body: Record<string, any>): Record<string, any> {
  const patch: Record<string, any> = {};

  if ('message' in body) patch.message = String(body.message ?? '').trim();
  for (const key of ['link_url', 'link_label', 'bg_color', 'text_color'] as const) {
    if (key in body) {
      const value = String(body[key] ?? '').trim();
      patch[key] = value.length > 0 ? value : null;
    }
  }
  if ('theme' in body) patch.theme = String(body.theme ?? 'brand').trim() || 'brand';
  if ('scrolling' in body) patch.scrolling = Boolean(body.scrolling);
  if ('dismissible' in body) patch.dismissible = Boolean(body.dismissible);
  if ('enabled' in body) patch.enabled = Boolean(body.enabled);

  if ('speed_seconds' in body) {
    const n = Number(body.speed_seconds);
    // Same clamp the renderer applies, enforced here so a bad value never
    // reaches the database in the first place.
    patch.speed_seconds = Number.isFinite(n) ? Math.min(120, Math.max(6, Math.round(n))) : 24;
  }
  if ('sort_order' in body) {
    const n = Number(body.sort_order);
    patch.sort_order = Number.isFinite(n) ? Math.round(n) : 0;
  }
  for (const key of ['starts_at', 'ends_at'] as const) {
    if (key in body) {
      const value = String(body[key] ?? '').trim();
      patch[key] = value.length > 0 ? new Date(value).toISOString() : null;
    }
  }
  return patch;
}
