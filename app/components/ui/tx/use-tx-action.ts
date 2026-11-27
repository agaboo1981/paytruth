'use client';

import { PublicKey } from '@solana/web3.js';
import { useCallback, useEffect, useReducer, useRef } from 'react';

import { sdk } from '../sdk/client';
import type { Invoice } from '../sdk/types';
import { mapTxError, type MappedTxError } from './tx-errors';
import { initialTxState, txReducer, type TxEvent, type TxPhase, type TxState } from './tx-machine';

export type TxActionOptions = {
  /** Predicate the invoice account must satisfy before we call it confirmed. */
  waitFor?: (invoice: Invoice) => boolean;
  /** Invoice PDA to poll after the write resolves. Omit to skip account polling. */
  invoicePda?: PublicKey;
  waitTimeoutMs?: number;
};

export type TxActionRun = () => Promise<{ signature: string }>;

export type UseTxActionResult = {
  state: TxState;
  run: () => void;
  reset: () => void;
  isInFlight: boolean;
};

function isInFlight(status: TxPhase): boolean {
  return status === 'awaiting-signature' || status === 'sending' || status === 'confirming';
}

function eventForMappedError(mapped: MappedTxError): TxEvent {
  if (mapped.phase === 'rejected') return { type: 'REJECT', error: mapped.error };
  if (mapped.phase === 'expired') return { type: 'EXPIRE', error: mapped.error };
  return { type: 'FAIL', error: mapped.error };
}

/**
 * Drives one write through the mock/real SDK. Because SDK writes only resolve
 * after confirmation, we start at awaiting-signature, nudge to sending after a
 * short grace period, then poll the account before declaring success.
 */
export function useTxAction(action: TxActionRun, options: TxActionOptions = {}): UseTxActionResult {
  const [state, dispatch] = useReducer(txReducer, initialTxState);
  const actionRef = useRef(action);
  actionRef.current = action;
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const sendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (sendingTimer.current) clearTimeout(sendingTimer.current);
    };
  }, []);

  const reset = useCallback(() => {
    if (sendingTimer.current) clearTimeout(sendingTimer.current);
    dispatch({ type: 'RESET' });
  }, []);

  const run = useCallback(() => {
    if (sendingTimer.current) clearTimeout(sendingTimer.current);
    dispatch({ type: 'RESET' });
    dispatch({ type: 'SUBMIT' });

    sendingTimer.current = setTimeout(() => {
      dispatch({ type: 'SIGNED' });
    }, 1200);

    void (async () => {
      try {
        const result = await actionRef.current();

        if (sendingTimer.current) clearTimeout(sendingTimer.current);

        const { invoicePda, waitFor, waitTimeoutMs } = optionsRef.current;
        if (invoicePda && waitFor) {
          dispatch({ type: 'CONFIRMING', signature: result.signature });
          await sdk.waitForInvoiceState(invoicePda, waitFor, {
            commitment: 'finalized',
            timeoutMs: waitTimeoutMs ?? 60000,
          });
        } else {
          dispatch({ type: 'CONFIRMING', signature: result.signature });
        }

        if (mounted.current) dispatch({ type: 'CONFIRMED', signature: result.signature });
      } catch (error) {
        if (sendingTimer.current) clearTimeout(sendingTimer.current);
        if (mounted.current) dispatch(eventForMappedError(mapTxError(error)));
      }
    })();
  }, []);

  return { state, run, reset, isInFlight: isInFlight(state.status) };
}
