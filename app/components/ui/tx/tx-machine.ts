export type TxPhase =
  | 'idle'
  | 'awaiting-signature'
  | 'sending'
  | 'confirming'
  | 'confirmed'
  | 'failed'
  | 'rejected'
  | 'expired';

export type TxError = { code: string; message: string; raw?: string };

export type TxState = {
  status: TxPhase;
  signature?: string;
  error?: TxError;
};

export type TxEvent =
  | { type: 'SUBMIT' }
  | { type: 'SIGNED' }
  | { type: 'SENT'; signature: string }
  | { type: 'CONFIRMING'; signature: string }
  | { type: 'CONFIRMED'; signature: string }
  | { type: 'FAIL'; error: TxError }
  | { type: 'REJECT'; error?: TxError }
  | { type: 'EXPIRE'; error?: TxError }
  | { type: 'RESET' };

export const initialTxState: TxState = { status: 'idle' };

const rejectedError: TxError = {
  code: 'USER_REJECTED',
  message: 'You cancelled the transaction.',
};

const expiredError: TxError = {
  code: 'BLOCKHASH_EXPIRED',
  message: 'This transaction expired. Try again.',
};

function isInFlight(status: TxPhase): boolean {
  return status === 'awaiting-signature' || status === 'sending' || status === 'confirming';
}

export function txReducer(state: TxState, event: TxEvent): TxState {
  switch (event.type) {
    case 'SUBMIT':
      return state.status === 'idle' ? { status: 'awaiting-signature' } : state;
    case 'SIGNED':
      return state.status === 'awaiting-signature' ? { ...state, status: 'sending' } : state;
    case 'SENT':
      return state.status === 'awaiting-signature' || state.status === 'sending'
        ? { ...state, status: 'sending', signature: event.signature, error: undefined }
        : state;
    case 'CONFIRMING':
      return isInFlight(state.status)
        ? { ...state, status: 'confirming', signature: event.signature, error: undefined }
        : state;
    case 'CONFIRMED':
      return isInFlight(state.status)
        ? { ...state, status: 'confirmed', signature: event.signature, error: undefined }
        : state;
    case 'FAIL':
      return isInFlight(state.status)
        ? { ...state, status: 'failed', error: event.error }
        : state;
    case 'REJECT':
      return isInFlight(state.status)
        ? { ...state, status: 'rejected', error: event.error ?? rejectedError }
        : state;
    case 'EXPIRE':
      return isInFlight(state.status)
        ? { ...state, status: 'expired', error: event.error ?? expiredError }
        : state;
    case 'RESET':
      return { status: 'idle' };
    default:
      return state;
  }
}
