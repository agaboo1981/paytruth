'use client';

import * as ToastPrimitive from '@radix-ui/react-toast';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { cn } from './utils';

type ToastTone = 'default' | 'success' | 'warning' | 'danger' | 'pending';

type ToastOptions = {
  title: string;
  description?: string;
  tone?: ToastTone;
  duration?: number;
  action?: {
    label: string;
    href: string;
  };
};

type ToastItem = ToastOptions & { id: number; open: boolean };

type ToastContextValue = { toast: (options: ToastOptions) => void };

const ToastContext = createContext<ToastContextValue | null>(null);

const tones: Record<ToastTone, string> = {
  default: 'border-[var(--border)] text-fg',
  success: 'border-[var(--success)] text-success',
  warning: 'border-[var(--warning)] text-warning',
  danger: 'border-[var(--danger)] text-danger',
  pending: 'border-[var(--pending)] text-pending',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const toast = useCallback((options: ToastOptions) => {
    const id = nextId.current;
    nextId.current += 1;
    setItems((current) => [...current.slice(-3), { ...options, id, open: true }]);
  }, []);

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      <ToastPrimitive.Provider swipeDirection="right" duration={5000}>
        {children}
        {items.map((item) => (
          <ToastPrimitive.Root
            key={item.id}
            open={item.open}
            onOpenChange={(open) => {
              if (!open) dismiss(item.id);
            }}
            duration={item.duration ?? 5000}
            className={cn(
              'toast-root rounded-md border bg-surface p-4 pr-12 shadow-lift',
              tones[item.tone ?? 'default'],
            )}
          >
            <ToastPrimitive.Title className="text-small font-semibold text-fg">
              {item.title}
            </ToastPrimitive.Title>
            {item.description ? (
              <ToastPrimitive.Description className="mt-1 break-words text-small text-muted">
                {item.description}
              </ToastPrimitive.Description>
            ) : null}
            {item.action ? (
              <ToastPrimitive.Action asChild altText={item.action.label}>
                <a
                  href={item.action.href}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex min-h-8 items-center rounded-xs border border-[var(--accent)] px-2 text-small font-semibold text-accent transition-colors duration-fast hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                >
                  {item.action.label}
                </a>
              </ToastPrimitive.Action>
            ) : null}
            <ToastPrimitive.Close
              className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-xs border border-border text-muted transition-colors duration-fast hover:border-[var(--accent)] hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              aria-label="Dismiss notification"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                <path
                  d="M2.5 2.5l9 9m0-9l-9 9"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        ))}
        <ToastPrimitive.Viewport className="toast-viewport fixed bottom-4 right-4 z-[60] flex w-[min(92vw,24rem)] flex-col gap-2 outline-none" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used inside ToastProvider');
  }
  return context;
}

export type { ToastOptions, ToastTone };
