"use client";

/**
 * "You're $28 away from free shipping" — the cart's nudge toward the
 * free-shipping threshold.
 *
 * Display only. Whether an order actually ships free is settled server-side at
 * hand-off against a subtotal derived from the catalog (see
 * /api/checkout/puramass), so a bar that is briefly out of step with a price
 * change can't hand anyone free shipping.
 *
 * Renders nothing unless the promo is live and a real threshold is set, so
 * callers can drop it in unconditionally.
 *
 * Two shapes. `card` is the boxed version the checkout summary uses. `bar` is
 * the single-line strip that sits under the cart's line items — the same
 * numbers on one row, because there it follows a list of products rather than
 * introducing a column of totals.
 */
import React from "react";
import { motion } from "framer-motion";
import { CheckCircle2, PartyPopper, Truck } from "lucide-react";
import { freeShippingProgress } from "@/lib/payments/puramass-shipping";

export default function FreeShippingProgress({
  subtotal,
  threshold,
  active,
  variant = "card",
  className = "",
}: {
  /** Cart goods subtotal, CAD. */
  subtotal: number;
  /** Subtotal that unlocks free shipping, CAD. */
  threshold: number;
  /** The promo is switched on. */
  active: boolean;
  /** `card` for a boxed block, `bar` for the cart's one-line strip. */
  variant?: "card" | "bar";
  className?: string;
}) {
  const progress = active ? freeShippingProgress(subtotal, threshold) : null;
  if (!progress) return null;

  const { pct, remaining, unlocked } = progress;

  if (variant === "bar") {
    return (
      <div
        className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-3.5 py-3 transition-colors duration-300 ${
          unlocked
            ? "border-emerald-200 bg-emerald-50"
            : "border-teal/25 bg-teal/5"
        } ${className}`}
      >
        <div
          className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg ${
            unlocked ? "bg-emerald-500 text-white" : "bg-teal/15 text-teal-dark"
          }`}
        >
          <Truck className="h-3.5 w-3.5" />
        </div>

        <p
          className={`text-xs font-semibold ${
            unlocked ? "text-emerald-800" : "text-ink"
          }`}
        >
          {unlocked
            ? "You're eligible for FREE shipping!"
            : `Add $${remaining.toFixed(2)} for FREE shipping`}
        </p>

        {/* The bar takes what is left of the row, and drops to its own line on
            a narrow screen rather than squeezing the message out. */}
        <div className="flex min-w-[8rem] flex-1 items-center gap-2">
          <div
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-line/70"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(pct)}
            aria-label="Progress toward free shipping"
          >
            <motion.div
              className={`h-full rounded-full ${
                unlocked
                  ? "bg-emerald-500"
                  : "bg-gradient-to-r from-teal/70 to-teal"
              }`}
              initial={false}
              animate={{ width: `${pct}%` }}
              transition={{ type: "spring", stiffness: 180, damping: 26 }}
            />
          </div>
          {unlocked ? (
            <span className="flex items-center gap-1.5 whitespace-nowrap text-[11px] font-medium text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Free shipping unlocked
            </span>
          ) : (
            <span className="whitespace-nowrap text-[11px] tabular-nums text-ink-muted">
              ${subtotal.toFixed(2)} / ${threshold.toFixed(2)}
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`rounded-xl border p-3.5 transition-colors duration-300 ${
        unlocked
          ? "border-emerald-200 bg-emerald-50"
          : "border-teal/25 bg-teal/5"
      } ${className}`}
    >
      <div className="flex items-start gap-2.5">
        <div
          className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${
            unlocked ? "bg-emerald-500 text-white" : "bg-teal/15 text-teal-dark"
          }`}
        >
          {unlocked ? (
            <PartyPopper className="h-4 w-4" />
          ) : (
            <Truck className="h-4 w-4" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <p
              className={`text-xs font-semibold ${
                unlocked ? "text-emerald-800" : "text-ink"
              }`}
            >
              {unlocked
                ? "Free shipping unlocked!"
                : `Add $${remaining.toFixed(2)} for free shipping`}
            </p>
            {/* The target, kept on the right so the eye lands on what's left. */}
            <p className="flex-shrink-0 text-[11px] tabular-nums text-ink-muted">
              <span className={unlocked ? "text-emerald-700" : "text-ink"}>
                ${subtotal.toFixed(2)}
              </span>
              <span className="mx-0.5">/</span>
              <span>${threshold.toFixed(2)}</span>
            </p>
          </div>

          <div
            className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-line/70"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(pct)}
            aria-label="Progress toward free shipping"
          >
            <motion.div
              className={`h-full rounded-full ${
                unlocked
                  ? "bg-emerald-500"
                  : "bg-gradient-to-r from-teal/70 to-teal"
              }`}
              initial={false}
              animate={{ width: `${pct}%` }}
              transition={{ type: "spring", stiffness: 180, damping: 26 }}
            />
          </div>

          <p
            className={`mt-1.5 text-[11px] leading-snug ${
              unlocked ? "text-emerald-700" : "text-ink-muted"
            }`}
          >
            {unlocked
              ? "Shipping is on us — pick any courier at checkout and it's free."
              : `Spend $${threshold.toFixed(2)} or more and we'll cover the shipping.`}
          </p>
        </div>
      </div>
    </div>
  );
}
