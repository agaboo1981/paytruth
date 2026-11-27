'use client';

import { useEffect, useReducer, useRef } from 'react';

import { Button } from '../button';
import { useToast } from '../toast';
import { mapTxError, type MappedTxError } from './tx-errors';
import { initialTxState, txReducer, type TxEvent, type TxPhase } from './tx-machine';
import { TxStatus } from './tx-status';

type SendResult = { signature: string };

type SendHelpers = {
  setPhase: (phase: 'sending' | 'confirming', signature?: string) => void;
};

export type SendFn = (helpers: SendHelpers) => Promise<SendResult>;

export type TxPanelProps = {
  send: SendFn;
  disabled?: boolean;
  label?: string;
};

function isInFlight(status: TxPhase): boolean {
  return (
    status === 'awaiting-signature' ||
    status === 'signed' ||
    status === 'sending' ||
    status === 'confirming'
  );
}

function isError(status: TxPhase): status is 'failed' | 'rejected' | 'expired' {
  return status === 'failed' || status === 'rejected' || status === 'expired';
}

function eventForMappedError(mapped: MappedTxError): TxEvent {
  if (mapped.phase === 'rejected') return { type: 'REJECT', error: mapped.error };
  if (mapped.phase === 'expired') return { type: 'EXPIRE', error: mapped.error };
  return { type: 'FAIL', error: mapped.error };
}

function explorerTxUrl(signature: string): string {
  return `https://explorer.solana.com/tx/${encodeURIComponent(signature)}?cluster=devnet`;
}

export function TxPanel({ send, disabled = false, label = 'Send transaction' }: TxPanelProps) {
  const [state, dispatch] = useReducer(txReducer, initialTxState);
  const { toast } = useToast();
  const signatureRef = useRef('');
  const notifiedRef = useRef<string | null>(null);
  const inFlight = isInFlight(state.status);

  useEffect(() => {
    const key = `${state.status}:${state.signature ?? ''}:${state.error?.code ?? ''}`;
    if (notifiedRef.current === key) return;

    if (state.status === 'confirmed' && state.signature) {
      notifiedRef.current = key;
      toast({
        title: 'Transaction confirmed',
        description: `Signature ${state.signature.slice(0, 8)}…${state.signature.slice(-4)}`,
        tone: 'success',
        action: {
          label: 'Explorer',
          href: explorerTxUrl(state.signature),
        },
      });
      return;
    }

    if (isError(state.status) && state.error) {
      notifiedRef.current = key;
      toast({
        title: labelsForToast[state.status],
        description: state.error.message,
        tone: state.status === 'failed' ? 'danger' : 'warning',
      });
    }
  }, [state.status, state.signature, state.error, toast]);

  function reset() {
    signatureRef.current = '';
    notifiedRef.current = null;
    dispatch({ type: 'RESET' });
  }

  function start() {
    reset();
    dispatch({ type: 'SUBMIT' });

    void (async () => {
      try {
        const result = await send({
          setPhase(phase, signature) {
            if (phase === 'sending') {
              if (signature) {
                signatureRef.current = signature;
                dispatch({ type: 'SENT', signature });
              } else {
                dispatch({ type: 'SIGNED' });
              }
              return;
            }

            const resolved = signature ?? signatureRef.current;
            dispatch({ type: 'CONFIRMING', signature: resolved });
          },
        });

        signatureRef.current = result.signature;
        dispatch({ type: 'CONFIRMED', signature: result.signature });
      } catch (error) {
        dispatch(eventForMappedError(mapTxError(error)));
      }
    })();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={start} loading={inFlight} disabled={disabled} size="lg">
          {inFlight ? 'Processing…' : label}
        </Button>
        {isError(state.status) || state.status === 'confirmed' ? (
          <Button variant="ghost" onClick={reset}>
            Reset status
          </Button>
        ) : null}
      </div>
      <TxStatus state={state} />
    </div>
  );
}

const labelsForToast: Record<'failed' | 'rejected' | 'expired', string> = {
  failed: 'Transaction failed',
  rejected: 'Transaction cancelled',
  expired: 'Transaction expired',
};
