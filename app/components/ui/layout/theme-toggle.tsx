'use client';

import { useEffect, useState } from 'react';

import { cn } from '../utils';

type Theme = 'dark' | 'light';

export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>('dark');

  useEffect(() => {
    let saved: Theme = 'dark';
    try {
      saved = window.localStorage.getItem('paytruth-theme') === 'light' ? 'light' : 'dark';
    } catch {
      saved = 'dark';
    }
    applyTheme(saved, false);
  }, []);

  function applyTheme(next: Theme, persist: boolean) {
    const root = document.documentElement;
    root.classList.toggle('light', next === 'light');
    root.classList.toggle('dark', next === 'dark');
    root.style.colorScheme = next;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', next === 'dark' ? '#071513' : '#f4f6ee');
    if (persist) {
      try {
        window.localStorage.setItem('paytruth-theme', next);
      } catch {
        setTheme(next);
        return;
      }
    }
    setTheme(next);
  }

  return (
    <button
      type="button"
      onClick={() => applyTheme(theme === 'dark' ? 'light' : 'dark', true)}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme from ${theme === 'dark' ? 'Dark' : 'Light'} mode`}
      aria-pressed={theme === 'light'}
      className={cn(
        'inline-flex min-h-10 items-center gap-2 rounded-sm border border-border bg-[var(--surface-2)] px-3 text-small font-semibold text-fg transition-colors duration-fast hover:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
        className,
      )}
    >
      <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
        {theme === 'dark' ? (
          <path
            d="M13 10.5A5.5 5.5 0 0 1 5.5 3 5.5 5.5 0 1 0 13 10.5Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
        ) : (
          <path
            d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        )}
      </svg>
      <span className="hidden sm:inline">{theme === 'dark' ? 'Dark' : 'Light'}</span>
    </button>
  );
}
