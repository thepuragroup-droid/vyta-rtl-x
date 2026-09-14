"use client";

/**
 * The free-shipping promo, following the shopper around the storefront.
 *
 * `FreeShippingProgress` already shows the same thing on the cart and checkout
 * screens — but by then the decision to buy is made. This is the nudge on the
 * pages where it still changes the order: a corner toast saying what is left to
 * spend, or that shipping is already covered.
 *
 * Display only, like the bar. Whether an order actually ships free is settled
 * server-side at hand-off against a subtotal derived from the catalog (see
 * /api/checkout/puramass), so a toast briefly out of step with a price change
 * cannot hand anyone free shipping.
 *
 * Renders nothing unless a promo is live, so it can be mounted unconditionally.
 */
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { PartyPopper, Truck, X } from "lucide-react";
import { useCart } from "@/contexts/CartContext";
import { usePromos } from "@/contexts/PromosContext";
import { freeShippingProgress } from "@/lib/payments/puramass-shipping";

/**
 * Sections that have no business being nudged: the staff portals, and the two
 * screens that already draw the full progress bar — a toast over the top of it
 * would be the same sentence twice.
 */
const SILENT_PATHS = ["/admin", "/warehouse", "/affiliate", "/cart", "/checkout"];

/** Remembered per tab, so a dismissal does not follow them to a new session. */
const DISMISS_KEY = "aminocan.freeShippingToast";

function remember(state: string) {
  try {
    sessionStorage.setItem(DISMISS_KEY, state);
  } catch {
    /* private mode / storage disabled — the toast simply comes back */
  }
}

function recalled(): string | null {
  try {
    return sessionStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}

export default function FreeShippingToast() {
  const pathname = usePathname();
  const { totalPrice } = useCart();
  const { freeShipping } = usePromos();

  const [dismissed, setDismissed] = useState<string | null>(null);
  // Held back for a moment so the toast arrives after the page has settled
  // rather than competing with it for attention.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setDismissed(recalled());
    const timer = setTimeout(() => setReady(true), 1200);
    return () => clearTimeout(timer);
  }, []);

  const progress = freeShipping.active
    ? freeShippingProgress(totalPrice, freeShipping.threshold)
    : null;

  // Dismissal is remembered against the state that was dismissed, not as a
  // single flag: someone who waved away "spend $40 more" should still be told
  // when they have crossed the line and earned it.
  const state = progress ? (progress.unlocked ? "unlocked" : "progress") : "none";
  const hidden =
    !progress ||
    !ready ||
    dismissed === state ||
    SILENT_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  const dismiss = () => {
    setDismissed(state);
    remember(state);
  };

  return (
    <AnimatePresence>
      {!hidden && progress && (
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.97 }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          role="status"
          aria-live="polite"
          /* Bottom-left, clear of the chat bubble in the opposite corner and of
             the transient toasts that stack above it. */
          className="fixed bottom-4 left-4 right-[5.5rem] z-40 sm:right-auto sm:w-[340px]"
        >
          <div
            className={`relative overflow-hidden rounded-2xl border shadow-xl shadow-black/10 backdrop-blur ${
              progress.unlocked
                ? "border-emerald-200 bg-emerald-50/95"
                : "border-line bg-white/95"
            }`}
          >
            <button
              type="button"
              onClick={dismiss}
              aria-label="Dismiss free shipping notice"
              className="absolute right-2 top-2 rounded-lg p-1 text-ink-muted transition-colors hover:bg-black/5 hover:text-ink"
            >
              <X className="h-3.5 w-3.5" />
            </button>

            <div className="flex items-start gap-3 p-3.5 pr-9">
              <div
                className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl ${
                  progress.unlocked
                    ? "bg-emerald-500 text-white"
                    : "bg-bronze/15 text-bronze"
                }`}
              >
                {progress.unlocked ? (
                  <PartyPopper className="h-4 w-4" />
                ) : (
                  <Truck className="h-4 w-4" />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <p
                  className={`text-xs font-semibold ${
                    progress.unlocked ? "text-emerald-800" : "text-ink"
                  }`}
                >
                  {progress.unlocked
                    ? "You've got free shipping"
                    : `You're $${progress.remaining.toFixed(2)} away from free shipping`}
                </p>

                <div
                  className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-line/70"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(progress.pct)}
                  aria-label="Progress toward free shipping"
                >
                  <motion.div
                    className={`h-full rounded-full ${
                      progress.unlocked
                        ? "bg-emerald-500"
                        : "bg-gradient-to-r from-bronze/70 to-bronze"
                    }`}
                    initial={false}
                    animate={{ width: `${progress.pct}%` }}
                    transition={{ type: "spring", stiffness: 180, damping: 26 }}
                  />
                </div>

                <p
                  className={`mt-1.5 text-[11px] leading-snug ${
                    progress.unlocked ? "text-emerald-700" : "text-ink-muted"
                  }`}
                >
                  {progress.unlocked ? (
                    <>
                      Shipping is on us on orders over $
                      {freeShipping.threshold.toFixed(2)} — pick any courier at
                      checkout and it&apos;s free.
                    </>
                  ) : (
                    <>
                      Spend ${freeShipping.threshold.toFixed(2)} or more and we&apos;ll
                      cover the shipping.{" "}
                      <Link
                        href="/products"
                        className="font-medium text-bronze underline-offset-2 hover:underline"
                      >
                        Keep shopping
                      </Link>
                    </>
                  )}
                </p>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
