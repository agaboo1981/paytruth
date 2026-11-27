import { Address } from '../address';
import { Badge, type BadgeProps } from '../badge';
import { ExplorerLink } from '../explorer-link';
import { cn } from '../utils';
import type { TxPhase, TxState } from './tx-machine';

type BadgeVariant = NonNullable<BadgeProps['variant']>;

const labels: Record<TxPhase, string> = {
  idle: 'Ready',
  'awaiting-signature': 'Waiting for your signature',
  sending: 'Sending transaction',
  confirming: 'Confirming on devnet',
  confirmed: 'Confirmed on devnet',
  failed: 'Transaction failed',
  rejected: 'Transaction cancelled',
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

function isInFlight(status: TxPhase): boolean {
  return status === 'awaiting-signature' || status === 'sending' || status === 'confirming';
}

function isError(status: TxPhase): boolean {
  return status === 'failed' || status === 'rejected' || status === 'expired';
}

export function TxStatus({ state, className }: { state: TxState; className?: string }) {
  const inFlight = isInFlight(state.status);

  return (
    <div
      role={isError(state.status) ? 'alert' : 'status'}
      aria-live={isError(state.status) ? 'assertive' : 'polite'}
      aria-atomic="true"
      className={cn(
        'flex min-h-24 flex-col gap-3 rounded-md border border-border bg-[var(--surface-2)] p-4',
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-3">
        {inFlight ? <span className="kit-spinner" aria-hidden="true" /> : null}
        <Badge variant={tones[state.status]}>{labels[state.status]}</Badge>
      </div>
      {state.signature ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-micro font-semibold text-muted">Signature</span>
          <Address address={state.signature} chars={6} />
          <ExplorerLink signature={state.signature}>Explorer</ExplorerLink>
        </div>
      ) : null}
      {state.error ? (
        <p className="break-words text-small text-danger">{state.error.message}</p>
      ) : null}
      {state.status === 'idle' ? (
        <p className="text-small text-muted">No transaction in progress.</p>
      ) : null}
    </div>
  );
}
