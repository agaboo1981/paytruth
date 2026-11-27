'use client';

import Link from 'next/link';

import { isMock } from '../sdk/client';
import { WalletArea } from '../wallet/wallet-area';
import { ThemeToggle } from './theme-toggle';

const navItems = [
  { href: '/merchant/new', label: 'Create invoice' },
  { href: '/verify', label: 'Verify' },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-bg text-fg">
      <a
        href="#main"
        className="skip-link fixed left-4 top-4 z-[100] rounded-sm bg-accent px-4 py-2 text-small font-semibold text-accent-fg"
      >
        Skip to content
      </a>

      {isMock ? (
        <div
          role="note"
          className="border-b border-[var(--warning)] bg-[var(--surface-2)] text-warning"
        >
          <div className="mx-auto flex w-full max-w-[1240px] items-center gap-2 px-5 py-2 text-small font-semibold md:px-8">
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
              <path d="M8 1.5l6.5 12h-13Z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
              <path d="M8 6v3.2M8 11.4v.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            <span>Demo mode — simulated data, nothing here is on Solana.</span>
          </div>
        </div>
      ) : null}

      <header className="sticky top-0 z-30 border-b border-border bg-bg/95 backdrop-blur supports-[backdrop-filter]:bg-bg/80">
        <div className="mx-auto flex w-full max-w-[1240px] flex-wrap items-center justify-between gap-x-3 gap-y-1 px-5 py-2 md:py-3 md:px-8">
          <Link
            href="/"
            className="inline-flex items-center gap-2.5 rounded-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            <span
              className="grid h-9 w-9 place-items-center rounded-sm border border-[var(--accent)] bg-[var(--surface-2)]"
              aria-hidden="true"
            >
              <svg width="18" height="18" viewBox="0 0 18 18">
                <path d="M5 9.5l2.5 2.5L13 6" fill="none" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="font-display text-title font-bold leading-none tracking-[-0.03em] text-fg">
              Paytruth
            </span>
          </Link>

          <div className="contents md:flex md:items-center md:gap-2">
            <nav aria-label="Main" className="order-3 -mx-3 w-full md:order-none md:mx-0 md:w-auto">
              <ul className="flex items-center gap-1">
                {navItems.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="inline-flex min-h-11 items-center rounded-xs px-3 text-small font-semibold text-muted transition-colors duration-fast hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
            <div className="order-2 flex items-center gap-2 md:order-none">
              <ThemeToggle />
              <WalletArea />
            </div>
          </div>
        </div>
      </header>

      <main id="main" tabIndex={-1} className="flex-1 outline-none">
        {children}
      </main>

      <footer className="mt-16 border-t border-border">
        <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-2 px-5 py-6 text-small text-muted md:flex-row md:items-center md:justify-between md:px-8">
          <span className="font-semibold text-fg">Paytruth</span>
          <span>Devnet only · Status is read from the Solana program, never from our server.</span>
        </div>
      </footer>
    </div>
  );
}
