'use client';

import React from 'react';

/**
 * The admin toggle switch.
 *
 * A real `role="switch"` button rather than a pair of on/off cards (the
 * settings page's `SelectCard` pattern), because a switch is the right control
 * for a tool you flip on inside a form you are already filling in — it does not
 * take a grid row, and screen readers announce it as on/off rather than as two
 * competing options.
 *
 * Label and description are rendered here so every switch in the admin reads
 * the same way, and the whole row is the hit target: a 44px-wide track is a
 * miserable thing to aim at.
 */
interface Props {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  /** One line under the label — what turning it on actually does. */
  description?: React.ReactNode;
  disabled?: boolean;
  /** Leading icon, sized 4×4 by the caller. */
  icon?: React.ReactNode;
  /** Extra classes on the wrapper — spacing is the caller's business. */
  className?: string;
}

export default function ToggleSwitch({
  checked,
  onChange,
  label,
  description,
  disabled = false,
  icon,
  className = '',
}: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
        checked ? 'border-teal/40 bg-teal/5' : 'border-line bg-white hover:bg-surface'
      } ${disabled ? 'cursor-not-allowed opacity-60' : ''} ${className}`}
    >
      {icon && (
        <span className={`mt-0.5 flex-shrink-0 ${checked ? 'text-teal-dark' : 'text-ink-muted'}`}>
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-ink">{label}</span>
        {description && (
          <span className="mt-0.5 block text-xs leading-relaxed text-ink-muted">{description}</span>
        )}
      </span>
      {/* The track. `aria-hidden` — the button itself carries the switch role. */}
      <span
        aria-hidden="true"
        className={`mt-0.5 inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full p-0.5 transition-colors ${
          checked ? 'bg-teal' : 'bg-line'
        }`}
      >
        <span
          className={`h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </span>
    </button>
  );
}
