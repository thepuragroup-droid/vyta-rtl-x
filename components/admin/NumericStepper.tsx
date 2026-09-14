'use client';

import React from 'react';

interface NumericStepperProps {
  value: number | '';
  onChange: (v: number | '') => void;
  min?: number;
  step?: number;
  placeholder?: string;
  disabled?: boolean;
  prefix?: string;
  /** Extra attributes spread onto the underlying <input> (e.g. onKeyDown, data-*). */
  inputProps?: React.InputHTMLAttributes<HTMLInputElement>;
}

export default function NumericStepper({
  value,
  onChange,
  min,
  step = 0.01,
  placeholder,
  disabled = false,
  prefix,
  inputProps,
}: NumericStepperProps) {
  function decrement() {
    if (disabled) return;
    const current = value === '' ? 0 : value;
    const next = current - step;
    const clamped = min !== undefined ? Math.max(min, next) : next;
    onChange(Math.round(clamped * 1e8) / 1e8);
  }

  function increment() {
    if (disabled) return;
    const current = value === '' ? 0 : value;
    const next = current + step;
    onChange(Math.round(next * 1e8) / 1e8);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    if (raw === '') {
      onChange('');
      return;
    }
    const parsed = parseFloat(raw);
    if (!Number.isFinite(parsed)) return;
    const clamped = min !== undefined ? Math.max(min, parsed) : parsed;
    onChange(clamped);
  }

  return (
    <div className="flex items-center border border-line rounded-lg overflow-hidden bg-surface focus-within:ring-2 focus-within:ring-bronze/40">
      <button
        type="button"
        onClick={decrement}
        disabled={disabled}
        className="px-2.5 py-2 text-ink-muted hover:text-ink hover:bg-surface disabled:opacity-40 select-none text-base leading-none flex-shrink-0 border-r border-line"
        aria-label="Decrement"
      >
        −
      </button>
      <div className="flex items-center flex-1 min-w-0">
        {prefix && (
          <span className="pl-2 text-xs text-ink-muted flex-shrink-0">{prefix}</span>
        )}
        <input
          type="number"
          value={value}
          min={min}
          step={step}
          placeholder={placeholder}
          disabled={disabled}
          onChange={handleChange}
          {...inputProps}
          className="w-full bg-transparent px-2 py-2 text-sm text-ink tabular-nums focus:outline-none disabled:opacity-40 text-center"
        />
      </div>
      <button
        type="button"
        onClick={increment}
        disabled={disabled}
        className="px-2.5 py-2 text-ink-muted hover:text-ink hover:bg-surface disabled:opacity-40 select-none text-base leading-none flex-shrink-0 border-l border-line"
        aria-label="Increment"
      >
        +
      </button>
    </div>
  );
}
