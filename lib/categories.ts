import {
  Beaker,
  TestTube,
  Heart,
  Sparkles,
  Dna,
  Brain,
  Zap,
  Pill,
  Scale,
  FlaskConical,
  Microscope,
  Leaf,
  Droplet,
  Activity,
  ShieldCheck,
  Flame,
  Moon,
  type LucideIcon,
} from 'lucide-react';

/**
 * A controlled storefront category. Mirrors the `store_categories` table.
 * `slug` is the stable key and equals products.category (string join, no FK).
 */
export interface StoreCategory {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  icon: string;
  sort_order: number;
  active: boolean;
  featured: boolean;
  created_at?: string;
  updated_at?: string;
}

/**
 * The allowed icon set. `store_categories.icon` stores a Lucide icon NAME (a
 * string) — the DB never holds React. The client maps name → component here.
 * Porting to a non-Lucide UI means swapping only this map.
 */
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  Beaker,
  TestTube,
  Heart,
  Sparkles,
  Dna,
  Brain,
  Zap,
  Pill,
  Scale,
  FlaskConical,
  Microscope,
  Leaf,
  Droplet,
  Activity,
  ShieldCheck,
  Flame,
  Moon,
};

/** Icon names offered in the category admin `<select>`. */
export const CATEGORY_ICON_KEYS = Object.keys(CATEGORY_ICONS);

/** Resolve an icon name to a component, falling back to Beaker. */
export function getCategoryIcon(key: string | null | undefined): LucideIcon {
  if (key && CATEGORY_ICONS[key]) return CATEGORY_ICONS[key];
  return Beaker;
}

/**
 * Client fetch of the public category list. Never throws; returns [] on any
 * failure so the storefront falls back to its built-in list instead of
 * breaking. Pass { featuredOnly: true } for the homepage grid.
 */
export async function getStoreCategories(
  opts?: { featuredOnly?: boolean },
): Promise<StoreCategory[]> {
  try {
    const qs = opts?.featuredOnly ? '?featured=1' : '';
    const res = await fetch(`/api/categories${qs}`, { cache: 'no-store' });
    if (!res.ok) return [];
    const data = await res.json().catch(() => null);
    const rows = data?.categories;
    return Array.isArray(rows) ? (rows as StoreCategory[]) : [];
  } catch {
    return [];
  }
}
