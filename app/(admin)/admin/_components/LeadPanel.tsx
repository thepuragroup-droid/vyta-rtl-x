'use client';

import React, { useEffect, useState } from 'react';
import { UserCheck, Loader2, Save, Lock, CalendarClock } from 'lucide-react';
import {
  CONTACT_METHODS,
  LEAD_STATUSES,
  LEAD_STATUS_META,
  type ContactMethod,
  type Lead,
  type LeadStatus,
} from '@/lib/admin/customer-leads';

interface Props {
  lead: Lead;
  meId: string | null;
  /** False until customer-crm-migration.sql runs. */
  available: boolean;
  /** "customer" / "affiliate" — used in the claim copy. */
  subjectLabel?: string;
  claiming: boolean;
  saving: boolean;
  onClaim: () => void;
  onRelease: () => void;
  onSave: (patch: {
    status: LeadStatus;
    contact_method: ContactMethod | '';
    notes: string;
    last_contacted_at: string;
    next_follow_up_at: string;
  }) => void;
}

/** `datetime-local` wants "YYYY-MM-DDTHH:mm" in local time, not an ISO string. */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * The lead desk for one person — a customer or an affiliate: who owns them, how
 * the relationship is doing, how they're being contacted, and the working notes
 * behind it.
 *
 * Both desks render this same panel against the same record, because an
 * affiliate is the customer with the same email. Claim them on either page and
 * both show the claim.
 *
 * Editing is gated on the claim — that is what claiming is for. An unclaimed
 * lead stays open to any admin so triage doesn't require claiming first.
 */
export default function LeadPanel({
  lead, meId, available, claiming, saving, subjectLabel = 'customer', onClaim, onRelease, onSave,
}: Props) {
  const [status, setStatus] = useState<LeadStatus>(lead.status);
  const [method, setMethod] = useState<ContactMethod | ''>(lead.contact_method ?? '');
  const [notes, setNotes] = useState(lead.notes ?? '');
  const [lastContacted, setLastContacted] = useState(toLocalInput(lead.last_contacted_at));
  const [followUp, setFollowUp] = useState(toLocalInput(lead.next_follow_up_at));

  // Re-seed when the lead is reloaded (claim, release, save).
  useEffect(() => {
    setStatus(lead.status);
    setMethod(lead.contact_method ?? '');
    setNotes(lead.notes ?? '');
    setLastContacted(toLocalInput(lead.last_contacted_at));
    setFollowUp(toLocalInput(lead.next_follow_up_at));
  }, [lead]);

  const claimed = Boolean(lead.claimed_by_id);
  const claimedByMe = claimed && lead.claimed_by_id === meId;
  const lockedByOther = claimed && !claimedByMe;
  const canEdit = available && !lockedByOther;

  const dirty =
    status !== lead.status ||
    method !== (lead.contact_method ?? '') ||
    notes !== (lead.notes ?? '') ||
    lastContacted !== toLocalInput(lead.last_contacted_at) ||
    followUp !== toLocalInput(lead.next_follow_up_at);

  const overdue =
    lead.next_follow_up_at != null && new Date(lead.next_follow_up_at).getTime() < Date.now();

  return (
    <div
      className={`rounded-xl border p-5 md:p-6 ${
        claimed ? 'border-emerald-200 bg-emerald-50/60' : 'border-bronze/30 bg-bronze/5'
      }`}
    >
      {/* Claim header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div
            className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${
              claimed ? 'bg-emerald-100' : 'bg-bronze/15'
            }`}
          >
            <UserCheck className={`h-5 w-5 ${claimed ? 'text-emerald-700' : 'text-bronze'}`} />
          </div>
          <div>
            <h2 className="text-sm font-bold text-ink">
              {claimed ? 'Claimed' : 'Not yet claimed'}
            </h2>
            {claimed ? (
              <p className="mt-0.5 text-sm text-ink-muted">
                Owned by{' '}
                <span className="font-semibold text-ink">
                  {lead.claimed_by_name || lead.claimed_by_email || 'an admin'}
                </span>
                {lead.claimed_at
                  ? ` since ${new Date(lead.claimed_at).toLocaleDateString(undefined, { dateStyle: 'medium' })}`
                  : ''}
                {claimedByMe && <span className="ml-1 font-medium text-emerald-700">— that&apos;s you</span>}
              </p>
            ) : (
              <p className="mt-0.5 text-sm text-ink-muted">
                Claim this {subjectLabel} to become their point of contact and own the relationship.
              </p>
            )}
          </div>
        </div>

        <div className="shrink-0">
          {!available ? (
            <span className="text-xs italic text-ink-muted">Migration required</span>
          ) : !claimed ? (
            <button
              onClick={onClaim}
              disabled={claiming}
              className="inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink/90 disabled:opacity-50"
            >
              {claiming ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserCheck className="h-4 w-4" />}
              Claim {subjectLabel}
            </button>
          ) : claimedByMe ? (
            <button
              onClick={onRelease}
              disabled={claiming}
              className="inline-flex items-center gap-2 rounded-lg border border-line bg-white px-4 py-2.5 text-sm font-medium text-ink hover:bg-surface disabled:opacity-50"
            >
              {claiming ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Release claim
            </button>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
              <Lock className="h-3.5 w-3.5" /> Held by someone else
            </span>
          )}
        </div>
      </div>

      {available && (
        <div className="mt-5 border-t border-white/60 pt-5">
          {lockedByOther && (
            <p className="mb-4 flex items-center gap-1.5 rounded-lg bg-white/70 px-3 py-2 text-xs text-ink-muted">
              <Lock className="h-3.5 w-3.5" />
              Read-only — {lead.claimed_by_name || 'the owner'} has to release the claim before
              anyone else can change the lead.
            </p>
          )}

          {/* Status */}
          <FieldLabel>Lead status</FieldLabel>
          <div className="flex flex-wrap gap-1.5">
            {LEAD_STATUSES.map((s) => {
              const active = s.key === status;
              return (
                <button
                  key={s.key}
                  onClick={() => canEdit && setStatus(s.key)}
                  disabled={!canEdit}
                  title={s.hint}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                    active ? s.solid : `${s.chip} hover:opacity-80`
                  }`}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
          <p className="mt-1.5 text-xs text-ink-muted">{LEAD_STATUS_META[status].hint}</p>

          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <div>
              <FieldLabel>Contacting them by</FieldLabel>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value as ContactMethod | '')}
                disabled={!canEdit}
                className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-bronze/40 disabled:opacity-60"
              >
                <option value="">Not set</option>
                {CONTACT_METHODS.map((m) => (
                  <option key={m.key} value={m.key}>{m.label}</option>
                ))}
              </select>
            </div>
            <div>
              <FieldLabel>Last contacted</FieldLabel>
              <input
                type="datetime-local"
                value={lastContacted}
                onChange={(e) => setLastContacted(e.target.value)}
                disabled={!canEdit}
                className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-bronze/40 disabled:opacity-60"
              />
            </div>
            <div>
              <FieldLabel>Next follow-up</FieldLabel>
              <input
                type="datetime-local"
                value={followUp}
                onChange={(e) => setFollowUp(e.target.value)}
                disabled={!canEdit}
                className={`w-full rounded-lg border bg-white px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-bronze/40 disabled:opacity-60 ${
                  overdue ? 'border-red-300' : 'border-line'
                }`}
              />
              {overdue && (
                <p className="mt-1 flex items-center gap-1 text-xs text-red-600">
                  <CalendarClock className="h-3 w-3" /> Follow-up is overdue
                </p>
              )}
            </div>
          </div>

          <div className="mt-4">
            <FieldLabel>Notes</FieldLabel>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={!canEdit}
              rows={4}
              placeholder="What you've discussed, what they're after, what to do next…"
              className="w-full resize-y rounded-lg border border-line bg-white px-3 py-2 text-sm leading-relaxed text-ink placeholder-ink-muted focus:outline-none focus:ring-2 focus:ring-bronze/40 disabled:opacity-60"
            />
          </div>

          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-xs text-ink-muted">
              {lead.updated_by_name && lead.updated_at
                ? `Last updated by ${lead.updated_by_name} · ${new Date(lead.updated_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`
                : 'Not updated yet'}
            </p>
            <button
              onClick={() =>
                onSave({
                  status,
                  contact_method: method,
                  notes,
                  last_contacted_at: lastContacted ? new Date(lastContacted).toISOString() : '',
                  next_follow_up_at: followUp ? new Date(followUp).toISOString() : '',
                })
              }
              disabled={!canEdit || !dirty || saving}
              className="inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-ink/90 disabled:opacity-40"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save lead
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-muted">
      {children}
    </label>
  );
}
