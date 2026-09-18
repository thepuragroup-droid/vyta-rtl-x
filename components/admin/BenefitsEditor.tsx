'use client';

import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import { formatBenefits, parseBenefits } from '@/lib/products/benefits';

/**
 * The bullet-list editor for a product's benefits.
 *
 * The field was a single free-text box that the storefront split on commas, so
 * "add another point" had no answer other than typing one more comma — and a
 * point could never contain one. This is the list it always wanted to be: one
 * row per point, Add point at the bottom, arrows to reorder, a bin to remove.
 *
 * It still writes the same `products.benefits` text column (one point per
 * line), so nothing needs migrating and a product written before this opens
 * with its existing points already split out.
 *
 * "Paste a list" is the escape hatch for bulk work: paste from a document, a
 * spreadsheet column or even `<li>` markup, and it is turned into rows.
 */

interface BenefitsEditorProps {
  /** The raw `products.benefits` value. */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

const rowClass =
  'w-full px-3 py-2 bg-surface border border-line rounded-lg text-ink text-sm focus:outline-none focus:ring-2 focus:ring-teal/40 disabled:opacity-60';

export default function BenefitsEditor({ value, onChange, disabled = false }: BenefitsEditorProps) {
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');

  // The rows are held locally rather than re-derived from the stored text on
  // every render, because a row you have just added is EMPTY — and an empty
  // row is not stored (it would read back as no point at all). Deriving would
  // make "Add point" appear to do nothing.
  const [points, setPoints] = useState<string[]>(() => parseBenefits(value));
  // The last text this editor itself wrote, so the sync below can tell its own
  // echo from a genuine outside change (a different product being opened, or
  // the form being reset).
  const ownWrite = useRef(value);

  useEffect(() => {
    if (value === ownWrite.current) return;
    ownWrite.current = value;
    setPoints(parseBenefits(value));
  }, [value]);

  const emit = (next: string[]) => {
    setPoints(next);
    const text = formatBenefits(next);
    ownWrite.current = text;
    onChange(text);
  };

  const setPoint = (index: number, text: string) =>
    emit(points.map((point, i) => (i === index ? text : point)));

  const addPoint = () => emit([...points, '']);

  const removePoint = (index: number) => emit(points.filter((_, i) => i !== index));

  const move = (from: number, to: number) => {
    if (to < 0 || to >= points.length) return;
    const next = [...points];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    emit(next);
  };

  const applyBulk = () => {
    const pasted = parseBenefits(bulkText);
    if (pasted.length === 0) return;
    emit([...points, ...pasted]);
    setBulkText('');
    setBulkOpen(false);
  };

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <label className="block text-sm font-medium text-ink">Benefits</label>
        <span className="text-[11px] text-ink-muted">
          One point per row — these are the ticks under the product description.
        </span>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setBulkOpen((open) => !open)}
          className="ml-auto text-[11px] font-medium text-teal-dark underline-offset-2 hover:underline disabled:opacity-40"
        >
          {bulkOpen ? 'Cancel paste' : 'Paste a list'}
        </button>
      </div>

      {bulkOpen && (
        <div className="mb-3 rounded-lg border border-teal/40 bg-teal-50/60 p-3">
          <textarea
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            rows={4}
            placeholder={'Paste one point per line. Bullets, numbering and pasted\n<li> markup are all understood and cleaned up.'}
            className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-teal/40"
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={applyBulk}
              disabled={parseBenefits(bulkText).length === 0}
              className="rounded-lg bg-ink px-3 py-1.5 text-xs font-semibold text-white hover:bg-ink/90 disabled:opacity-40"
            >
              Add {parseBenefits(bulkText).length || ''} point
              {parseBenefits(bulkText).length === 1 ? '' : 's'}
            </button>
            <span className="text-[11px] text-ink-muted">Appended to the list below.</span>
          </div>
        </div>
      )}

      {points.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line bg-surface px-3 py-4 text-center text-xs text-ink-muted">
          No benefits yet. Add the first point below.
        </p>
      ) : (
        <div className="space-y-2">
          {points.map((point, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-5 flex-shrink-0 text-center text-xs font-medium text-ink-muted tabular-nums">
                {i + 1}
              </span>
              <input
                type="text"
                value={point}
                disabled={disabled}
                onChange={(e) => setPoint(i, e.target.value)}
                onKeyDown={(e) => {
                  // Enter starts the next point, the way a list wants to be typed.
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const next = [...points];
                    next.splice(i + 1, 0, '');
                    emit(next);
                  }
                }}
                placeholder={`Benefit ${i + 1}`}
                className={rowClass}
              />
              <div className="flex flex-shrink-0 items-center">
                <button
                  type="button"
                  title="Move up"
                  disabled={disabled || i === 0}
                  onClick={() => move(i, i - 1)}
                  className="rounded p-1.5 text-ink-muted hover:bg-surface hover:text-ink disabled:opacity-30"
                >
                  <ChevronUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  title="Move down"
                  disabled={disabled || i === points.length - 1}
                  onClick={() => move(i, i + 1)}
                  className="rounded p-1.5 text-ink-muted hover:bg-surface hover:text-ink disabled:opacity-30"
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  title="Remove point"
                  disabled={disabled}
                  onClick={() => removePoint(i)}
                  className="rounded p-1.5 text-ink-muted hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        disabled={disabled}
        onClick={addPoint}
        className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface disabled:opacity-40"
      >
        <Plus className="h-3.5 w-3.5" />
        Add point
      </button>

      <p className="mt-2 text-[11px] leading-relaxed text-ink-muted">
        A point can carry <strong>**bold**</strong>, <em>*italic*</em> and{' '}
        <span className="font-mono">[a link](/products)</span>. HTML tags are not rendered — paste
        them if it is easier and they will be converted into points.
      </p>
    </div>
  );
}
