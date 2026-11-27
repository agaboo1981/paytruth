import { Address } from '../address';
import { Badge, type BadgeProps } from '../badge';
import { ExplorerLink } from '../explorer-link';
import { isMock } from '../sdk/client';
import { cn } from '../utils';
import type { TxPhase, TxState } from './tx-machine';

type BadgeVariant = NonNullable<BadgeProps['variant']>;

const labels: Record<TxPhase, string> = {
  idle: 'Ready',
  'awaiting-signature': 'Waiting for your wallet',
  sending: 'Sending to Solana',
  confirming: 'Confirming on Solana',
  confirmed: 'Confirmed on Solana',
  failed: "Couldn't complete",
  rejected: 'You cancelled',
  expired: 'Transaction expired',
};

const tones: Record<TxPhase, BadgeVariant> = {
  idle: 'default',
  'awaiting-signature': 'pending',
  sending: 'pending',
  confirming: 'pending',
  confirmed: 'success',
  failed: 'danger',
  rejected: 'warning',
  expired: 'warning',
};

const progressCopy: Partial<Record<TxPhase, string>> = {
  'awaiting-signature': 'Check your wallet — approve the request to continue.',
  sending: 'Sending to Solana… (if your wallet is still open, approve it there)',
  confirming: 'Sent. Waiting for the network to confirm — usually a few seconds.',
  confirmed: 'Done. Confirmed on Solana.',
  rejected: 'You cancelled in your wallet. Nothing was sent and no money moved.',
  expired: "The network didn't pick this up in time. No money moved — it's safe to try again.",
};

function isInFlight(status: TxPhase): boolean {
  return status === 'awaiting-signature' || status === 'sending' || status === 'confirming';
}

function isError(status: TxPhase): boolean {
  return status === 'failed' || status === 'rejected' || status === 'expired';
}

function Spinner() {
  return (
    <span className="kit-spinner motion-spinner" aria-hidden="true">
      <span className="spinner-still" />
    </span>
  );
}

export function TxStatus({
  state,
  className,
  mock = isMock,
}: {
  state: TxState;
  className?: string;
  mock?: boolean;
}) {
  const inFlight = isInFlight(state.status);
  const error = isError(state.status);
  const message =
    state.status === 'failed'
      ? state.error?.message
      : state.status === 'idle'
        ? 'Nothing is happening yet.'
        : progressCopy[state.status];

  if (state.status === 'idle') {
    // Keep the live region mounted (so the first update is announced) but show nothing.
    return <div role="status" aria-live="polite" aria-atomic="true" className="sr-only" />;
  }

  return (
    <div
      role={error ? 'alert' : 'status'}
      aria-live={error ? 'assertive' : 'polite'}
      aria-atomic="true"
      className={cn(
        'flex min-h-24 flex-col gap-3 rounded-md border bg-[var(--surface-2)] p-4',
        error ? 'border-[var(--danger)]' : state.status === 'confirmed' ? 'border-[var(--success)]' : 'border-border',
        'motion-status',
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-3">
        {inFlight ? <Spinner /> : null}
        <Badge variant={tones[state.status]}>{labels[state.status]}</Badge>
      </div>
      {message ? (
        <p
          className={cn(
            'text-small',
            state.status === 'failed' ? 'text-danger' : state.status === 'confirmed' ? 'text-success' : 'text-fg',
          )}
        >
          {message}
        </p>
      ) : null}
      {state.signature ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-micro font-semibold text-muted">{mock ? 'Signature (simulated)' : 'Signature'}</span>
          <Address address={state.signature} chars={6} />
          {mock ? (
            <span className="text-micro font-semibold text-warning">Simulated</span>
          ) : (
            <ExplorerLink signature={state.signature}>Explorer</ExplorerLink>
          )}
        </div>
      ) : null}
    </div>
  );
}
