import { describe, expect, it } from 'vitest';

import { initialTxState, txReducer, type TxState } from './tx-machine';

const signature = '5wjL9x9V8d8YQvYgqK3xvKpZtGpXvHqNjWmR6cYs7Tf';

function state(status: TxState['status'], signature?: string): TxState {
  return signature ? { status, signature } : { status };
}

describe('txReducer', () => {
  it('starts idle with no signature or error', () => {
    expect(initialTxState).toEqual({ status: 'idle' });
  });

  it('moves from idle to awaiting-signature on SUBMIT', () => {
    expect(txReducer(initialTxState, { type: 'SUBMIT' })).toEqual({
      status: 'awaiting-signature',
    });
  });

  it('moves from awaiting-signature to signed on SIGNED', () => {
    expect(txReducer(state('awaiting-signature'), { type: 'SIGNED' })).toEqual({
      status: 'signed',
    });
  });

  it('records the signature when SENT arrives from awaiting-signature', () => {
    expect(
      txReducer(state('awaiting-signature'), { type: 'SENT', signature }),
    ).toEqual({ status: 'sending', signature });
  });

  it('records the signature when SENT arrives from signed', () => {
    expect(txReducer(state('signed'), { type: 'SENT', signature })).toEqual({
      status: 'sending',
      signature,
    });
  });

  it('records the signature when SENT arrives from sending', () => {
    expect(txReducer(state('sending'), { type: 'SENT', signature })).toEqual({
      status: 'sending',
      signature,
    });
  });

  it('moves to confirming from sending and threads the signature', () => {
    expect(
      txReducer(state('sending'), { type: 'CONFIRMING', signature }),
    ).toEqual({ status: 'confirming', signature });
  });

  it('allows confirming directly from signed', () => {
    expect(txReducer(state('signed'), { type: 'CONFIRMING', signature })).toEqual({
      status: 'confirming',
      signature,
    });
  });

  it('allows confirming directly from awaiting-signature', () => {
    expect(
      txReducer(state('awaiting-signature'), { type: 'CONFIRMING', signature }),
    ).toEqual({ status: 'confirming', signature });
  });

  it('preserves an existing signature when a later CONFIRMING has the same signature', () => {
    expect(
      txReducer(state('sending', signature), {
        type: 'CONFIRMING',
        signature,
      }),
    ).toEqual({ status: 'confirming', signature });
  });

  it.each(['awaiting-signature', 'signed', 'sending', 'confirming'] as const)(
    'confirms from %s',
    (status) => {
      expect(
        txReducer(state(status, signature), {
          type: 'CONFIRMED',
          signature,
        }),
      ).toEqual({ status: 'confirmed', signature });
    },
  );

  it.each(['awaiting-signature', 'signed', 'sending', 'confirming'] as const)(
    'fails from %s and keeps the signature',
    (status) => {
      const error = { code: 'UNKNOWN', message: 'Transaction failed.' };
      expect(txReducer(state(status, signature), { type: 'FAIL', error })).toEqual({
        status: 'failed',
        signature,
        error,
      });
    },
  );

  it.each(['awaiting-signature', 'signed', 'sending', 'confirming'] as const)(
    'rejects from %s',
    (status) => {
      expect(txReducer(state(status), { type: 'REJECT' })).toEqual({
        status: 'rejected',
        error: { code: 'USER_REJECTED', message: 'You cancelled the transaction.' },
      });
    },
  );

  it.each(['awaiting-signature', 'signed', 'sending', 'confirming'] as const)(
    'expires from %s',
    (status) => {
      expect(txReducer(state(status), { type: 'EXPIRE' })).toEqual({
        status: 'expired',
        error: { code: 'BLOCKHASH_EXPIRED', message: 'This transaction expired. Try again.' },
      });
    },
  );

  it('uses a supplied REJECT error', () => {
    const error = { code: 'WALLET', message: 'Wallet closed.' };
    expect(
      txReducer(state('awaiting-signature'), { type: 'REJECT', error }),
    ).toEqual({ status: 'rejected', error });
  });

  it('uses a supplied EXPIRE error', () => {
    const error = { code: 'EXPIRED', message: 'Blockhash gone.' };
    expect(txReducer(state('sending'), { type: 'EXPIRE', error })).toEqual({
      status: 'expired',
      error,
    });
  });

  it.each(['confirmed', 'failed', 'rejected', 'expired'] as const)(
    'does nothing on SUBMIT from %s',
    (status) => {
      const current = state(status);
      expect(txReducer(current, { type: 'SUBMIT' })).toBe(current);
    },
  );

  it('does nothing on SIGNED from idle', () => {
    expect(txReducer(initialTxState, { type: 'SIGNED' })).toBe(initialTxState);
  });

  it('does nothing on SIGNED from signed', () => {
    const current = state('signed');
    expect(txReducer(current, { type: 'SIGNED' })).toBe(current);
  });

  it('does nothing on SIGNED from confirming', () => {
    const current = state('confirming', signature);
    expect(txReducer(current, { type: 'SIGNED' })).toBe(current);
  });

  it('does nothing on terminal states for failure events', () => {
    const current = state('confirmed', signature);
    expect(
      txReducer(current, { type: 'FAIL', error: { code: 'X', message: 'x' } }),
    ).toBe(current);
    expect(txReducer(current, { type: 'REJECT' })).toBe(current);
    expect(txReducer(current, { type: 'EXPIRE' })).toBe(current);
  });

  it('does nothing when confirming after confirmation', () => {
    const current = state('confirmed', signature);
    expect(
      txReducer(current, { type: 'CONFIRMING', signature }),
    ).toBe(current);
  });

  it('resets from every terminal state', () => {
    for (const status of ['confirmed', 'failed', 'rejected', 'expired'] as const) {
      expect(txReducer(state(status, signature), { type: 'RESET' })).toEqual(initialTxState);
    }
  });

  it('resets from idle and in-flight states', () => {
    for (const status of ['idle', 'awaiting-signature', 'signed', 'sending', 'confirming'] as const) {
      expect(txReducer(state(status, signature), { type: 'RESET' })).toEqual(initialTxState);
    }
  });

  it('does not mutate the state it receives', () => {
    const current = state('awaiting-signature');
    txReducer(current, { type: 'SENT', signature });
    expect(current).toEqual({ status: 'awaiting-signature' });
  });
});
