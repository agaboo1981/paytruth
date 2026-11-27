import { describe, expect, it } from 'vitest';
import { MEMO_LEN } from '../../src/constants';
import { MemoTooLongError } from '../../src/errors';
import { decodeMemo, encodeMemo } from '../../src/memo';

describe('memo', () => {
  it('zero-pads a short memo to 64 bytes', () => {
    const out = encodeMemo('hello');
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out.length).toBe(MEMO_LEN);
    expect(out.slice(0, 5)).toEqual(Uint8Array.from([104, 101, 108, 108, 111]));
    expect(out.slice(5).every((b) => b === 0)).toBe(true);
  });

  it('accepts exactly 64 bytes', () => {
    const input = new Uint8Array(64).fill(7);
    const out = encodeMemo(input);
    expect(out.length).toBe(64);
    expect(Array.from(out)).toEqual(Array.from(input));
  });

  it('throws MemoTooLongError for 65 bytes (never truncates)', () => {
    expect(() => encodeMemo(new Uint8Array(65))).toThrow(MemoTooLongError);
  });

  it('counts multibyte UTF-8 bytes, not characters', () => {
    // '€' is 3 bytes in UTF-8. 21 * 3 = 63 bytes -> ok, 22 * 3 = 66 -> throws.
    expect(() => encodeMemo('€'.repeat(21))).not.toThrow();
    expect(encodeMemo('€'.repeat(21)).length).toBe(64);
    expect(() => encodeMemo('€'.repeat(22))).toThrow(MemoTooLongError);
  });

  it('rejects a string whose encoded length exceeds 64 across a boundary', () => {
    // 'a' * 63 + '€' = 63 + 3 = 66 bytes -> throws.
    expect(() => encodeMemo('a'.repeat(63) + '€')).toThrow(MemoTooLongError);
  });

  it('decodes by stripping trailing zeros', () => {
    expect(decodeMemo(encodeMemo('invoice #42'))).toBe('invoice #42');
    expect(decodeMemo(new Uint8Array(64))).toBe('');
  });

  it('round-trips multibyte text', () => {
    const s = 'shop café — €5';
    expect(decodeMemo(encodeMemo(s))).toBe(s);
  });
});
