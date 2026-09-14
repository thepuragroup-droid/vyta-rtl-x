'use client';

import { AlertCircle, RefreshCw } from 'lucide-react';

/**
 * Shown when a load is taking longer than expected, offering a manual retry
 * without tearing down the skeleton.
 */
export function SlowLoadingNotice({ onReload }: { onReload: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-4">
      <div className="flex items-center gap-2 text-sm text-amber-800">
        <RefreshCw className="w-4 h-4 animate-spin" />
        Still loading… this is taking longer than usual.
      </div>
      <button
        onClick={onReload}
        className="text-sm font-medium text-amber-900 hover:underline whitespace-nowrap"
      >
        Reload
      </button>
    </div>
  );
}

/**
 * Terminal error state with a retry action.
 */
export function LoadingError({
  message = 'Something went wrong while loading.',
  onRetry,
}: {
  message?: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6">
      <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mb-4">
        <AlertCircle className="w-6 h-6 text-red-500" />
      </div>
      <p className="text-sm text-ink-muted mb-4 max-w-sm">{message}</p>
      <button
        onClick={onRetry}
        className="inline-flex items-center gap-2 px-4 py-2 bg-ink text-white rounded-lg hover:bg-ink/90 transition-colors text-sm font-medium"
      >
        <RefreshCw className="w-4 h-4" />
        Try again
      </button>
    </div>
  );
}
