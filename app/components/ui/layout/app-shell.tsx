import type { ReactNode } from 'react';

import { ThemeToggle } from './theme-toggle';

const navItems = [
  { href: '#tokens', label: 'Tokens' },
  { href: '#components', label: 'Components' },
  { href: '#wallet', label: 'Wallet' },
  { href: '#transactions', label: 'Transactions' },
];

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-bg text-fg">
      <a
        href="#main-content"
        className="skip-link fixed left-4 top-4 z-[100] rounded-sm bg-accent px-4 py-2 text-small font-semibold text-accent-fg"
      >
        Skip to content
      </a>
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-[1240px] flex-wrap items-center justify-between gap-4 px-5 py-4 md:px-8">
          <a
            href="/kit"
            className="inline-flex items-center gap-3 rounded-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            <span className="grid h-9 w-9 place-items-center rounded-sm border border-[var(--accent)] bg-[var(--surface-2)] font-mono text-small font-bold text-accent" aria-hidden="true">
              S9
            </span>
            <span>
              <span className="block font-display text-title font-bold leading-none tracking-[-0.03em] text-fg">
                Solana UI Kit
              </span>
              <span className="block text-micro font-semibold text-muted">Direction-agnostic primitives</span>
            </span>
          </a>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-pill border border-[var(--warning)] px-2.5 py-1 text-micro font-semibold text-warning">
              Devnet only
            </span>
            <ThemeToggle />
          </div>
          <nav aria-label="Kit sections" className="w-full">
            <ul className="flex flex-wrap gap-x-5 gap-y-2 border-t border-border pt-3">
              {navItems.map((item) => (
                <li key={item.href}>
                  <a
                    href={item.href}
                    className="inline-flex min-h-8 items-center rounded-xs text-small font-semibold text-muted transition-colors duration-fast hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className="outline-none">
        {children}
      </main>
      <footer className="mt-12 border-t border-border">
        <div className="mx-auto flex w-full max-w-[1240px] flex-wrap justify-between gap-3 px-5 py-6 text-small text-muted md:px-8">
          <span>Built for the Dev3pack hackathon.</span>
          <span>No mainnet. No program client. No secrets.</span>
        </div>
      </footer>
    </div>
  );
}
