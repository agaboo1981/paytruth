'use client';

import { PublicKey } from '@solana/web3.js';
import { useCallback, useEffect, useReducer, useRef } from 'react';

import type { WriteOptions } from '../../../lib/paytruth';
import { sdk } from '../sdk/client';
import type { Invoice } from '../sdk/types';
import { mapTxError, type MappedTxError } from './tx-errors';
import { initialTxState, txReducer, type TxEvent, type TxPhase, type TxState } from './tx-machine';

export type TxActionOptions = {
  waitFor?: (invoice: Invoice) => boolean;
  invoicePda?: PublicKey;
  waitTimeoutMs?: number;
  skipWaitFor?: boolean;
  onConfirmed?: () => void | Promise<void>;
};

export type TxActionRun = (opts: WriteOptions) => Promise<{ signature: string }>;

export type UseTxActionResult = {
  state: TxState;
  run: () => void;
  reset: () => void;
  isInFlight: boolean;
};

function isInFlight(status: TxPhase): boolean {
  return (
    status === 'awaiting-signature' ||
    status === 'signed' ||
    status === 'sending' ||
    status === 'confirming'
  );
}

function eventForMappedError(mapped: MappedTxError): TxEvent {
  if (mapped.phase === 'rejected') return { type: 'REJECT', error: mapped.error };
  if (mapped.phase === 'expired') return { type: 'EXPIRE', error: mapped.error };
  return { type: 'FAIL', error: mapped.error };
}

export function useTxAction(action: TxActionRun, options: TxActionOptions = {}): UseTxActionResult {
  const [state, dispatch] = useReducer(txReducer, initialTxState);
  const actionRef = useRef(action);
  actionRef.current = action;
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const reset = useCallback(() => {
    dispatch({ type: 'RESET' });
  }, []);

  const run = useCallback(() => {
    dispatch({ type: 'RESET' });
    dispatch({ type: 'SUBMIT' });

    let stageSignature = '';
    void (async () => {
      try {
        const result = await actionRef.current({
          onStage(stage, info) {
            if (!mounted.current) return;
            if (info?.signature) stageSignature = info.signature;
            if (stage === 'awaiting-signature') dispatch({ type: 'SUBMIT' });
            if (stage === 'signed') dispatch({ type: 'SIGNED' });
            if (stage === 'sent') dispatch({ type: 'SENT', signature: info?.signature ?? stageSignature });
            if (stage === 'confirmed') {
              dispatch({ type: 'CONFIRMING', signature: info?.signature ?? stageSignature });
            }
          },
        });

        const signature = result.signature || stageSignature;
        dispatch({ type: 'CONFIRMING', signature });

        const { invoicePda, waitFor, waitTimeoutMs, skipWaitFor } = optionsRef.current;
        if (invoicePda && waitFor && !skipWaitFor) {
          await sdk.waitForInvoiceState(invoicePda, waitFor, {
            commitment: 'finalized',
            timeoutMs: waitTimeoutMs ?? 60000,
          });
        }

        if (!mounted.current) return;
        dispatch({ type: 'CONFIRMED', signature });
        await optionsRef.current.onConfirmed?.();
      } catch (error) {
        if (mounted.current) dispatch(eventForMappedError(mapTxError(error)));
      }
    })();
  }, []);

  return { state, run, reset, isInFlight: isInFlight(state.status) };
}
