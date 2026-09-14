'use client';

import React from 'react';

interface ProductOption {
  id: string;
  name: string;
  slug?: string | null;
  price: number;
}

interface ProductToggleSelectorProps {
  products: ProductOption[];
  value: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
  label?: string;
}

export default function ProductToggleSelector({
  products,
  value,
  onChange,
  disabled = false,
  label = 'Product',
}: ProductToggleSelectorProps) {
  return (
    <div>
      <label className="block text-xs font-medium text-ink-muted mb-1">{label}</label>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        disabled={disabled}
        className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-bronze/40 disabled:opacity-60"
      >
        <option value="">Select a product…</option>
        {products.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} (${p.price.toFixed(2)})
          </option>
        ))}
      </select>
    </div>
  );
}
