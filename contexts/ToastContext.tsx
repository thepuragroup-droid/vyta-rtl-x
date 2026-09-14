'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, AlertCircle, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
  /** ms before auto-dismiss; 0 disables auto-dismiss. */
  duration: number;
}

interface ToastApi {
  success: (message: string, duration?: number) => void;
  error: (message: string, duration?: number) => void;
  info: (message: string, duration?: number) => void;
}

const ToastContext = createContext<ToastApi | undefined>(undefined);

const DEFAULT_DURATION = 6000;

const STYLES: Record<ToastType, { ring: string; icon: React.ReactNode }> = {
  success: {
    ring: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    icon: <Check className="w-4 h-4 text-emerald-600" />,
  },
  error: {
    ring: 'border-red-200 bg-red-50 text-red-700',
    icon: <AlertCircle className="w-4 h-4 text-red-600" />,
  },
  info: {
    ring: 'border-line bg-white text-ink',
    icon: <Info className="w-4 h-4 text-teal-dark" />,
  },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const remove = useCallback((id: number) => {
    setToasts((cur) => cur.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (message: string, type: ToastType, duration = DEFAULT_DURATION) => {
      const id = ++idRef.current;
      setToasts((cur) => [...cur, { id, message, type, duration }]);
    },
    [],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (m: string, d?: number) => push(m, 'success', d),
      error: (m: string, d?: number) => push(m, 'error', d),
      info: (m: string, d?: number) => push(m, 'info', d),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* Bottom-center on mobile, bottom-right on desktop. */}
      <div
        className="fixed bottom-4 left-1/2 -translate-x-1/2 sm:left-auto sm:right-4 sm:translate-x-0 z-[200] flex flex-col gap-2 w-[min(92vw,360px)]"
        role="status"
        aria-live="polite"
      >
        <AnimatePresence initial={false}>
          {toasts.map((t) => (
            <ToastCard key={t.id} toast={t} onClose={() => remove(t.id)} />
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({
  toast,
  onClose,
}: {
  toast: ToastItem;
  onClose: () => void;
}) {
  const s = STYLES[toast.type];
  const remainingRef = useRef(toast.duration);
  const startRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const start = useCallback(() => {
    if (toast.duration <= 0) return; // 0 disables auto-dismiss
    clear();
    startRef.current = Date.now();
    timerRef.current = setTimeout(onClose, remainingRef.current);
  }, [clear, onClose, toast.duration]);

  useEffect(() => {
    start();
    return clear;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pause the countdown while the cursor rests over the toast.
  const pause = () => {
    if (toast.duration <= 0) return;
    clear();
    remainingRef.current -= Date.now() - startRef.current;
  };
  const resume = () => start();

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 12, scale: 0.96 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      onMouseEnter={pause}
      onMouseLeave={resume}
      className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm shadow-lg ${s.ring}`}
    >
      <span className="mt-0.5 shrink-0">{s.icon}</span>
      <span className="flex-1 leading-snug">{toast.message}</span>
      <button
        onClick={onClose}
        className="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
        aria-label="Dismiss"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </motion.div>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}
