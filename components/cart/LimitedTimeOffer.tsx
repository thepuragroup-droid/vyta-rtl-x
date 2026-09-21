'use client';

/**
 * "Limited Time Offer" — the strip at the top of the cart's order summary.
 *
 * Two states, both honest:
 *
 *   • not yet earned — "Add one more item and get 10% OFF your order!", with
 *     the number of items still needed;
 *   • earned — the saving is named and the total below already reflects it.
 *
 * The countdown only appears when the operator set a real end date, and it
 * counts down to THAT — the same timestamp `/api/checkout/puramass` checks
 * before it discounts anything. When it reaches zero the offer stops here and
 * at the checkout together, rather than the clock resetting itself on the next
 * page load the way a fake urgency timer would.
 *
 * Renders nothing when no offer is running, so the cart can drop it in
 * unconditionally.
 */
import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Gift } from 'lucide-react';
import { usePromos } from '@/contexts/PromosContext';

/** `endsAt` as hh:mm:ss remaining, or null once there is nothing left. */
function useCountdown(endsAt: string | null): string | null {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!endsAt) {
      setRemaining(null);
      return;
    }
    const end = new Date(endsAt).getTime();
    if (!Number.isFinite(end)) {
      setRemaining(null);
      return;
    }
    // Computed in an effect rather than during render: the server has no idea
    // what time it is in the visitor's browser, and a clock rendered on both
    // sides would hydrate to a mismatch.
    const tick = () => setRemaining(Math.max(0, end - Date.now()));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [endsAt]);

  if (remaining === null || remaining <= 0) return null;

  const totalSeconds = Math.floor(remaining / 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  // Days are folded into hours: a countdown reading "03 : 14 : 27" is read at a
  // glance, and one reading "2d 03:14:27" is a puzzle.
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

export default function LimitedTimeOffer({ className = '' }: { className?: string }) {
  const { cartOffer } = usePromos();
  const clock = useCountdown(cartOffer.endsAt);

  // An offer that is off, worth nothing, or past its end date shows nothing.
  // `itemsAway` and `earned` are both zero/false in that case.
  if (!cartOffer.enabled || cartOffer.percent <= 0) return null;
  if (cartOffer.endsAt && !clock && !cartOffer.earned && cartOffer.itemsAway === 0) return null;

  const { earned, itemsAway, percent } = cartOffer;

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-xl border px-4 py-3 ${
        earned
          ? 'border-emerald-200 bg-emerald-50'
          : 'border-teal/25 bg-teal/5'
      } ${className}`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${
            earned ? 'bg-emerald-500 text-white' : 'bg-teal/15 text-teal-dark'
          }`}
        >
          <Gift className="h-4 w-4" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p
              className={`text-sm font-semibold ${
                earned ? 'text-emerald-800' : 'text-ink'
              }`}
            >
              {earned ? `${percent}% OFF applied` : 'Limited Time Offer'}
            </p>
            {clock && (
              <span
                className={`font-mono text-xs tabular-nums ${
                  earned ? 'text-emerald-700' : 'text-ink-muted'
                }`}
                // The clock changes every second; announcing each tick would
                // make a screen reader unusable on this page.
                aria-hidden="true"
              >
                {clock}
              </span>
            )}
          </div>

          <p
            className={`mt-0.5 text-xs leading-snug ${
              earned ? 'text-emerald-700' : 'text-ink-muted'
            }`}
          >
            {earned ? (
              <>
                Your <span className="font-semibold">{percent}% discount</span> is in the
                total below.
              </>
            ) : (
              <>
                Add{' '}
                <span className="font-semibold text-ink">
                  {itemsAway} more item{itemsAway === 1 ? '' : 's'}
                </span>{' '}
                and get <span className="font-semibold text-ink">{percent}% OFF</span> your
                order!
              </>
            )}
          </p>

          {clock && (
            // The same deadline, once, in words a screen reader can use.
            <span className="sr-only">
              This offer ends {new Date(cartOffer.endsAt as string).toLocaleString()}.
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );
}
