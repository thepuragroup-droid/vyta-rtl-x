'use client';

import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import {
  PackageCheck, Truck, Navigation, Home, RefreshCw, Loader2,
  ExternalLink, AlertTriangle, MapPin, Radio, Map as MapIcon,
} from 'lucide-react';
import type { InvoiceTrackingSnapshot } from '@/lib/admin/invoices';

// Leaflet is client-only — load the map lazily so it never enters the SSR pass
// and its bundle isn't paid for until a shipment is actually being viewed.
const ShipmentMap = dynamic(() => import('@/components/admin/ShipmentMap'), {
  ssr: false,
  loading: () => (
    <div className="h-72 w-full rounded-lg border border-line bg-surface flex items-center justify-center text-sm text-ink-muted">
      <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading map…
    </div>
  ),
});

// The four milestones a parcel moves through. Easyship reports many raw status
// strings; `stageIndexFor` folds them onto this scale for the progress bar.
const STAGES = [
  { key: 'info', label: 'Info Received', Icon: PackageCheck },
  { key: 'transit', label: 'In Transit', Icon: Truck },
  { key: 'out', label: 'Out for Delivery', Icon: Navigation },
  { key: 'delivered', label: 'Delivered', Icon: Home },
] as const;

function normalize(status?: string | null): string {
  return (status || '').toLowerCase().replace(/[_\s-]/g, '');
}

function stageIndexFor(status?: string | null): number {
  const s = normalize(status);
  if (!s) return 0;
  if (s.includes('delivered')) return 3;
  if (s.includes('outfordelivery')) return 2;
  if (s.includes('transit')) return 1;
  // pending / pickup / info received / label created / manifested → step 0
  return 0;
}

// Exceptional states can't be placed on the happy-path bar — surface them as a
// warning instead of pretending the parcel is progressing.
function isException(status?: string | null): boolean {
  return /(exception|fail|return|expired|lost|damage|held|customs|cancel)/.test(
    normalize(status),
  );
}

function fmtTime(raw?: string | null): string {
  if (!raw) return '';
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? String(raw) : d.toLocaleString();
}

interface Props {
  tracking: InvoiceTrackingSnapshot | null;
  refreshing: boolean;
  onRefresh: () => void;
  editable: boolean;
}

/**
 * Prominent live-tracking panel for the top of the invoice detail page. Renders
 * a stage progress bar plus the Easyship checkpoint timeline (message +
 * location + time). Checkpoints only arrive on a live refresh, so when the
 * cached snapshot has none we prompt the admin to pull them.
 */
export default function LiveShipmentTracking({ tracking, refreshing, onRefresh, editable }: Props) {
  const [showMap, setShowMap] = useState(false);

  if (!tracking?.hasShipment || !tracking.tracking) return null;
  const t = tracking.tracking;

  const checkpoints = (t.checkpoints ?? [])
    .slice()
    .sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime());

  // Oldest → newest place labels for the map's journey path.
  const checkpointLocations = [...checkpoints]
    .reverse()
    .map((c) => c.location || '')
    .filter(Boolean);
  const mappable = checkpointLocations.length > 0 || !!tracking.destination;

  // Prefer the shipment's headline status; fall back to the newest checkpoint.
  const currentStatus = t.status ?? checkpoints[0]?.primary_status ?? null;
  const exception = isException(currentStatus);
  const stageIndex = stageIndexFor(currentStatus);
  const delivered = stageIndex === 3 && !exception;

  return (
    <div className="mb-6 bg-white rounded-xl border border-line overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-line">
        <div className="flex items-center gap-2 min-w-0">
          <Radio className={`w-4 h-4 flex-shrink-0 ${delivered ? 'text-emerald-500' : 'text-bronze'}`} />
          <h2 className="font-semibold text-ink text-sm">Live Shipment Tracking</h2>
          {t.carrier && (
            <span className="text-xs text-ink-muted truncate hidden sm:inline">· {t.carrier}</span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {mappable && (
            <button
              onClick={() => setShowMap((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                showMap
                  ? 'bg-bronze/10 border-bronze text-bronze'
                  : 'bg-surface border-line text-ink-muted hover:text-ink hover:border-ink/20'
              }`}
              title="Toggle the shipment map"
            >
              <MapIcon className="w-3.5 h-3.5" />
              {showMap ? 'Hide map' : 'Map'}
            </button>
          )}
          {editable && (
            <button
              onClick={onRefresh}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-surface border border-line text-ink-muted hover:text-ink hover:border-ink/20 transition-colors disabled:opacity-50"
              title="Pull the latest tracking from Easyship"
            >
              {refreshing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              {refreshing ? 'Refreshing…' : 'Refresh live'}
            </button>
          )}
        </div>
      </div>

      <div className="p-5">
        {/* Exception banner */}
        {exception && (
          <div className="mb-5 flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>
              This shipment reports an exception ({currentStatus}). Check the checkpoints below
              or the carrier page for details.
            </span>
          </div>
        )}

        {/* Stage progress bar */}
        {!exception && (
          <div className="flex items-center justify-between mb-5">
            {STAGES.map((stage, i) => {
              const done = i <= stageIndex;
              const isCurrent = i === stageIndex;
              const Icon = stage.Icon;
              return (
                <React.Fragment key={stage.key}>
                  <div className="flex flex-col items-center gap-2 flex-shrink-0">
                    <div
                      className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
                        done
                          ? delivered && i === 3
                            ? 'bg-emerald-500 text-white'
                            : 'bg-ink text-white'
                          : 'bg-surface text-ink-muted'
                      } ${isCurrent && !delivered ? 'ring-4 ring-bronze/20' : ''}`}
                    >
                      <Icon className="w-4 h-4" />
                    </div>
                    <span className={`text-[10px] text-center uppercase tracking-wider ${done ? 'text-bronze' : 'text-ink-muted'}`}>
                      {stage.label}
                    </span>
                  </div>
                  {i < STAGES.length - 1 && (
                    <div className={`flex-1 h-0.5 mx-1 sm:mx-2 -mt-5 rounded ${i < stageIndex ? 'bg-ink' : 'bg-surface'}`} />
                  )}
                </React.Fragment>
              );
            })}
          </div>
        )}

        {/* Facts row */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          {currentStatus && (
            <div>
              <span className="text-ink-muted text-xs uppercase tracking-wider mr-2">Status</span>
              <span className="font-medium text-ink">{currentStatus}</span>
            </div>
          )}
          {t.number && (
            <div className="min-w-0">
              <span className="text-ink-muted text-xs uppercase tracking-wider mr-2">Tracking</span>
              {t.url ? (
                <a
                  href={t.url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-xs text-bronze hover:underline inline-flex items-center gap-1"
                >
                  {t.number}
                  <ExternalLink className="w-3 h-3" />
                </a>
              ) : (
                <span className="font-mono text-xs text-ink">{t.number}</span>
              )}
            </div>
          )}
          {tracking.order_status && (
            <div>
              <span className="text-ink-muted text-xs uppercase tracking-wider mr-2">Order</span>
              <span className="capitalize text-ink">{tracking.order_status}</span>
            </div>
          )}
        </div>

        {/* Geographic journey map */}
        {mappable && showMap && (
          <div className="mt-5 pt-5 border-t border-line">
            <ShipmentMap checkpointLocations={checkpointLocations} destination={tracking.destination} />
          </div>
        )}

        {/* Checkpoint timeline */}
        {checkpoints.length > 0 ? (
          <div className="mt-5 pt-5 border-t border-line">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted mb-3">Journey</p>
            <ol className="space-y-0">
              {checkpoints.map((c, i) => {
                const latest = i === 0;
                return (
                  <li key={`${c.occurred_at}-${i}`} className="flex gap-3">
                    {/* Rail + dot */}
                    <div className="flex flex-col items-center">
                      <span
                        className={`w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0 ${
                          latest ? 'bg-bronze ring-4 ring-bronze/15' : 'bg-line'
                        }`}
                      />
                      {i < checkpoints.length - 1 && <span className="w-px flex-1 bg-line my-1" />}
                    </div>
                    {/* Content */}
                    <div className={`pb-4 min-w-0 ${latest ? '' : 'opacity-80'}`}>
                      <p className="text-sm text-ink">{c.message || c.primary_status || 'Update'}</p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-ink-muted">
                        {c.location && (
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="w-3 h-3" /> {c.location}
                          </span>
                        )}
                        {c.occurred_at && <span>{fmtTime(c.occurred_at)}</span>}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        ) : (
          <div className="mt-5 pt-5 border-t border-line">
            <p className="text-sm text-ink-muted">
              {editable
                ? 'No checkpoints loaded yet. Click "Refresh live" to pull the latest journey from Easyship.'
                : 'No live checkpoints available.'}
            </p>
          </div>
        )}

        {t.refresh_error && (
          <p className="mt-3 text-xs text-amber-600">Live refresh: {t.refresh_error}</p>
        )}
      </div>
    </div>
  );
}
