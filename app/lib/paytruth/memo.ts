// GENERATED from sdk/src by `pnpm sync:app` — do not edit here.
import { MEMO_LEN } from './constants';
import { MemoTooLongError } from './errors';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Encode a memo into a 64-byte zero-padded array. Accepts a UTF-8 string or a
 * raw byte array. Throws MemoTooLongError if the encoded length exceeds 64
 * bytes; never truncates.
 */
export function encodeMemo(memo: string | Uint8Array): Uint8Array {
  const bytes = typeof memo === 'string' ? encoder.encode(memo) : memo;
  if (bytes.length > MEMO_LEN) throw new MemoTooLongError(bytes.length, MEMO_LEN);
  const out = new Uint8Array(MEMO_LEN);
  out.set(bytes, 0);
  return out;
}

/** Decode a 64-byte memo, stripping trailing zero bytes, as a UTF-8 string. */
export function decodeMemo(memo: Uint8Array): string {
  let end = memo.length;
  while (end > 0 && memo[end - 1] === 0) end--;
  return decoder.decode(memo.subarray(0, end));
}
