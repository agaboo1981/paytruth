'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { isMock } from '../sdk/client';
import { WalletArea } from '../wallet/wallet-area';
import { ThemeToggle } from './theme-toggle';

const navItems = [
  { href: '/invoices/', label: 'My invoices' },
  { href: '/merchant/new', label: 'Create invoice' },
  { href: '/verify', label: 'Verify' },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);

  useEffect(() => setMenuOpen(false), [pathname]);

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1280px)');
    function closeOnDesktop() {
      if (desktop.matches) setMenuOpen(false);
    }
    desktop.addEventListener('change', closeOnDesktop);
    return () => desktop.removeEventListener('change', closeOnDesktop);
  }, []);

  return (
    <div className="flex min-h-screen min-h-[100svh] min-w-0 flex-col bg-bg text-fg">
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
          <div className="mx-auto flex w-full max-w-[1240px] items-center gap-2 px-4 py-2 text-small font-semibold sm:px-6 md:px-8">
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
              <path d="M8 1.5l6.5 12h-13Z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
              <path d="M8 6v3.2M8 11.4v.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            <span>Demo mode — simulated data, nothing here is on Solana.</span>
          </div>
        </div>
      ) : null}

      <header
        className="site-header sticky top-0 z-30 border-b border-border bg-bg/95 backdrop-blur supports-[backdrop-filter]:bg-bg/80"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && menuOpen) {
            setMenuOpen(false);
            menuButton.current?.focus();
          }
        }}
      >
        <div className="mx-auto grid w-full max-w-[1240px] grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-3 sm:px-6 md:px-8 xl:flex xl:gap-4">
          <Link
            href="/"
            onClick={() => setMenuOpen(false)}
            className="inline-flex w-fit shrink-0 items-center gap-2.5 rounded-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            <span
              className="grid h-9 w-9 shrink-0 place-items-center rounded-sm border border-[var(--accent)] bg-[var(--surface-2)]"
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

          <div className="flex shrink-0 items-center gap-2">
            <ThemeToggle />
            <button
              ref={menuButton}
              type="button"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
              aria-controls="main-navigation"
              onClick={() => setMenuOpen((open) => !open)}
              className="grid h-11 w-11 place-items-center rounded-sm border border-border bg-[var(--surface-2)] text-fg hover:border-[var(--accent)] xl:hidden"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                <path d={menuOpen ? 'M5 5l10 10M15 5L5 15' : 'M4 5h12M4 10h12M4 15h12'} />
              </svg>
            </button>
          </div>

          <div
            id="main-navigation"
            className={`${menuOpen ? 'flex' : 'hidden'} order-last col-span-2 min-w-0 mt-3 flex-col gap-4 border-t border-border pt-3 xl:order-none xl:ml-auto xl:mt-0 xl:flex xl:flex-row xl:items-center xl:border-0 xl:pt-0`}
          >
            <nav aria-label="Main">
              <ul className="flex flex-col gap-1 xl:flex-row xl:items-center">
                {navItems.map((item) => {
                  const active = pathname.replace(/\/$/, '') === item.href.replace(/\/$/, '');
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? 'page' : undefined}
                        onClick={() => setMenuOpen(false)}
                        className={`flex min-h-11 items-center rounded-sm px-3 text-small font-semibold transition-colors duration-fast hover:bg-[var(--surface-2)] hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${active ? 'bg-[var(--surface-2)] text-accent' : 'text-muted'}`}
                      >
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>
            <div className="min-w-0 border-t border-border pt-4 pb-1 xl:border-0 xl:p-0">
              <WalletArea />
            </div>
          </div>
        </div>
      </header>

      <main id="main" tabIndex={-1} className="min-w-0 flex-1 outline-none">
        {children}
      </main>

      <footer className="mt-10 border-t border-border sm:mt-16">
        <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-2 px-4 py-6 text-small text-muted sm:px-6 md:flex-row md:items-center md:justify-between md:gap-6 md:px-8">
          <span className="font-semibold text-fg">Paytruth</span>
          <span>Devnet only · Status is read from the Solana program, never from our server.</span>
        </div>
      </footer>
    </div>
  );
}
