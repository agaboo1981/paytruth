import type { Metadata, Viewport } from 'next';

import { AppShell } from '@/components/ui/layout/app-shell';
import { ToastProvider } from '@/components/ui/toast';
import '@/styles/globals.css';

export const metadata: Metadata = {
  title: 'Paytruth — invoices that prove they were paid',
  description:
    'Wallet-to-wallet USDC invoices on Solana devnet with on-chain escrow. Anyone can verify a payment from the chain.',
  applicationName: 'Paytruth',
};

export const viewport: Viewport = {
  themeColor: '#071513',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <meta name="page-type" content="software" />
        <meta name="site-kind" content="software" />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('paytruth-theme');if(t==='light'){document.documentElement.classList.remove('dark');document.documentElement.classList.add('light');document.documentElement.style.colorScheme='light';}}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        {/* Integration point (Full-Stack owns): wrap with the wallet/connection provider here. */}
        <ToastProvider>
          <AppShell>{children}</AppShell>
        </ToastProvider>
      </body>
    </html>
  );
}
