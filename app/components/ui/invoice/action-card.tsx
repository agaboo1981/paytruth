'use client';

import { PublicKey } from '@solana/web3.js';
import type { ReactNode } from 'react';

import { Button } from '../button';
import type { Invoice } from '../sdk/types';
import { TxStatus } from '../tx/tx-status';
import { useTxAction, type TxActionRun } from '../tx/use-tx-action';

export type InvoiceAction = {
  key: string;
  label: string;
  description: ReactNode;
  send: TxActionRun;
  waitFor?: (invoice: Invoice) => boolean;
  variant?: 'primary' | 'secondary' | 'danger';
  disabledReason?: string;
  note?: ReactNode;
};

export function ActionCard({
  action,
  invoicePda,
}: {
  action: InvoiceAction;
  invoicePda: PublicKey;
}) {
  const tx = useTxAction(action.send, {
    invoicePda,
    waitFor: action.waitFor,
  });

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4 shadow-panel">
      <div className="flex flex-col gap-1">
        <h3 className="font-display text-title font-bold text-fg">{action.label}</h3>
        <p className="text-small text-muted">{action.description}</p>
        {action.note ? <p className="text-small text-warning">{action.note}</p> : null}
      </div>
      <div>
        <Button
          variant={action.variant ?? 'secondary'}
          onClick={tx.run}
          loading={tx.isInFlight}
          disabled={Boolean(action.disabledReason)}
        >
          {action.label}
        </Button>
        {action.disabledReason ? <p className="mt-1 text-small text-muted">{action.disabledReason}</p> : null}
      </div>
      {tx.state.status !== 'idle' ? <TxStatus state={tx.state} /> : null}
    </div>
  );
}
