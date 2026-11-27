import { describe, expect, it } from 'vitest';
import { staleIdlFiles } from '../../scripts/sync-idl';

describe('IDL copy matches the Anchor Engineer artifacts (target/idl, target/types)', () => {
  it('src/idl is byte-identical to committed target/ files', () => {
    expect(staleIdlFiles()).toEqual([]);
  });
});
