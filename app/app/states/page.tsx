'use client';

import { Container } from '@/components/ui/layout/container';
import { StatusHero } from '@/components/ui/invoice/status-hero';
import type { DerivedKind } from '@/components/ui/sdk/format';
import type { TxPhase, TxState } from '@/components/ui/tx/tx-machine';
import { TxStatus } from '@/components/ui/tx/tx-status';

const txPhases: { phase: TxPhase; label: string; state: TxState }[] = [
  { phase: 'idle', label: 'Idle', state: { status: 'idle' } },
  { phase: 'awaiting-signature', label: 'Awaiting signature', state: { status: 'awaiting-signature' } },
  { phase: 'sending', label: 'Sending', state: { status: 'sending' } },
  { phase: 'confirming', label: 'Confirming', state: { status: 'confirming', signature: '5wjL9x9V8d8YQvYgqK3xvKpZtGpXvHqNjWmR6cYs7TfAAAA' } },
  { phase: 'confirmed', label: 'Success', state: { status: 'confirmed', signature: '5wjL9x9V8d8YQvYgqK3xvKpZtGpXvHqNjWmR6cYs7TfAAAA' } },
  { phase: 'rejected', label: 'Rejected', state: { status: 'rejected', error: { code: 'USER_REJECTED', message: 'You cancelled in your wallet. Nothing was sent and no money moved.' } } },
  { phase: 'expired', label: 'Expired', state: { status: 'expired', error: { code: 'BLOCKHASH_EXPIRED', message: "The network didn't pick this up in time. No money moved — it's safe to try again." } } },
  { phase: 'failed', label: 'Error — duplicate', state: { status: 'failed', error: { code: 'DuplicatePayment', message: 'This invoice is already paid. You were not charged again.' } } },
  { phase: 'failed', label: 'Error — underpayment', state: { status: 'failed', error: { code: 'Underpayment', message: "That's less than the amount due. Nothing was sent." } } },
  { phase: 'failed', label: 'Error — expired invoice', state: { status: 'failed', error: { code: 'InvoiceExpired', message: "This invoice has expired and can't be paid." } } },
];

const derivedSamples: { kind: DerivedKind; headline: string; explanation: string }[] = [
  { kind: 'open', headline: 'Awaiting payment', explanation: 'The invoice is open. Your customer can pay the amount due into escrow.' },
  { kind: 'expiring', headline: 'Expired, unpaid', explanation: 'The expiry time has passed and no one paid. The invoice can be marked expired.' },
  { kind: 'paid', headline: 'Paid, not claimed', explanation: 'The customer paid the full amount into escrow. Claim it to move the USDC to your wallet.' },
  { kind: 'overpaid-refund-due', headline: 'Paid with extra', explanation: 'The customer paid more than the amount due. The extra is held until it is refunded.' },
  { kind: 'refunded', headline: 'Paid and refunded', explanation: 'The customer was paid back the extra amount. The amount due is ready to claim.' },
  { kind: 'claimed', headline: 'Paid and claimed', explanation: 'The amount due has been claimed. Once the vault is empty the invoice can be closed.' },
  { kind: 'expired', headline: 'Expired', explanation: 'The invoice expired without a valid payment. Any leftover funds can be recovered.' },
];

export default function StatesPage() {
  return (
    <Container className="flex flex-col gap-10">
      <div>
        <h1 className="font-display text-headline font-bold tracking-[-0.03em] text-fg">UI states gallery</h1>
        <p className="mt-2 text-body text-muted">Static previews of every transaction phase and invoice state.</p>
      </div>

      <section aria-labelledby="tx-heading" className="flex flex-col gap-3">
        <h2 id="tx-heading" className="font-display text-title font-bold text-fg">Transaction status</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {txPhases.map((item) => (
            <div key={item.label} className="flex flex-col gap-2">
              <h3 className="text-small font-semibold text-muted">{item.label}</h3>
              <TxStatus state={item.state} />
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="invoice-heading" className="flex flex-col gap-3">
        <h2 id="invoice-heading" className="font-display text-title font-bold text-fg">Invoice states</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {derivedSamples.map((sample) => (
            <StatusHero key={sample.kind} kind={sample.kind} headline={sample.headline} explanation={sample.explanation} level={2} />
          ))}
        </div>
      </section>
    </Container>
  );
}
