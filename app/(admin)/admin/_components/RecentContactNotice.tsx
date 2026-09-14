'use client';

import React from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  RECENT_NUDGE_DAYS,
  describeNudge,
  recentlyNudged,
} from '@/lib/customer/audience';
import { recipientLabel, type OutreachRecipient } from '@/lib/customer/outreach-types';

/**
 * "Some of these people have just had an email from us."
 *
 * The composer's standing warning, drawn above the draft for as long as anybody
 * on the send heard from us inside RECENT_NUDGE_DAYS. It is the always-on
 * counterpart to the desk's opt-in "skip anyone already sent this" condition:
 * that one only bites once an admin has ticked an email type, and the case this
 * catches is the one nobody thinks to tick for — a colleague chased the same
 * cart on Tuesday, and this batch is about to chase it again.
 *
 * It warns and never blocks. A second nudge is often exactly the right call —
 * that is what a last-chance email IS — so the decision stays with the admin
 * and this only makes sure they are making it on purpose. Names are listed
 * rather than counted alone, because "3 of these were emailed recently" without
 * saying who is a number nobody can act on.
 *
 * Nothing renders when the send is clean, so the composer is unchanged for the
 * ordinary case.
 */
export default function RecentContactNotice({
  recipients,
  className = '',
}: {
  /** Everyone the send will address, the primary recipient included. */
  recipients: readonly OutreachRecipient[];
  className?: string;
}) {
  const recent = recentlyNudged(recipients);
  if (recent.length === 0) return null;

  const shown = recent.slice(0, 5);
  const rest = recent.length - shown.length;

  return (
    <div
      className={`rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900 ${className}`}
      role="status"
    >
      <p className="flex items-start gap-2 font-medium">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <span>
          {recent.length === recipients.length
            ? recipients.length === 1
              ? 'This customer has already had an email'
              : `All ${recent.length} of these customers have already had an email`
            : `${recent.length} of these ${recipients.length} customers ${
                recent.length === 1 ? 'has' : 'have'
              } already had an email`}{' '}
          in the last {RECENT_NUDGE_DAYS} days.
        </span>
      </p>
      <ul className="mt-1.5 space-y-0.5 pl-6">
        {shown.map((r) => (
          <li key={r.id} className="truncate">
            <span className="font-medium">{recipientLabel(r)}</span> — {describeNudge(r.nudge!)}
          </li>
        ))}
        {rest > 0 && <li>…and {rest} more.</li>}
      </ul>
      <p className="mt-1.5 pl-6 text-amber-800/80">
        Sending anyway is fine — a follow-up is often the point. Untick anyone this would be a
        repeat for, or set the desk&rsquo;s &ldquo;skip anyone already sent this&rdquo; condition
        on /admin/customers to hold them back automatically.
      </p>
    </div>
  );
}
