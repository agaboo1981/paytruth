import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Keypair, type Connection } from '@solana/web3.js';
import { describe, expect, it, vi } from 'vitest';
import {
  DEVNET_GENESIS_HASH,
  DEVNET_SOL_NEEDS,
  DEFAULT_AMOUNTS,
  assertDevnetGenesis,
  ensureUsdcBalance,
  extractCustomCode,
  isInsideRepo,
  loadKeypair,
  mapFailureMetaErr,
  resolveConfig,
  resolveDeploymentsPath,
  resolveEnvConfig,
  resolveRpcUrl,
  resolveUsdcWait,
  usdcNeeds,
  parseDevnetDeployment,
} from '../../scripts/devnet/lib';

const here = dirname(fileURLToPath(import.meta.url));
const sdkRoot = join(here, '..', '..');
const repoRoot = join(sdkRoot, '..');
const deploymentsPath = join(repoRoot, 'programs', 'DEPLOYMENTS.md');

// -- DEPLOYMENTS parser -----------------------------------------------------

describe('parseDevnetDeployment', () => {
  const real = readFileSync(deploymentsPath, 'utf8');

  it('parses the real DEPLOYMENTS.md devnet row', () => {
    expect(parseDevnetDeployment(real)).toEqual({
      programId: 'D8dnG9j1zSwwaJLyAvp794MJqEXptdiVS74gh6fNLQ7H',
      configPda: 'C9nFHNFgdTZ27PTz4pvrjxgmkWVyng4RNVFcpc4xLEPx',
      usdcMint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    });
  });

  it('resolves the deployments path from the script location', () => {
    expect(resolveDeploymentsPath()).toBe(deploymentsPath);
  });

  it('throws when no devnet row exists', () => {
    const md = [
      '| Cluster | Program ID | Config PDA | USDC mint |',
      '|---|---|---|---|',
      '| localnet | `ABC` | `DEF` | mint `GHI` |',
    ].join('\n');
    expect(() => parseDevnetDeployment(md)).toThrow(/devnet/i);
  });

  it('throws when the devnet row is missing a backticked value', () => {
    const md = [
      '| Cluster | Program ID | Config PDA | USDC mint |',
      '|---|---|---|---|',
      '| devnet | `` | `DEF` | Circle `GHI` |',
    ].join('\n');
    expect(() => parseDevnetDeployment(md)).toThrow(/program/i);
  });

  it('throws when a column is absent', () => {
    const md = ['| Cluster | Program ID |', '|---|---|', '| devnet | `ABC` |'].join('\n');
    expect(() => parseDevnetDeployment(md)).toThrow();
  });

  it('matches only an exact devnet cluster cell', () => {
    const md = [
      '| Cluster | Program ID | Config PDA | USDC mint |',
      '|---|---|---|---|',
      '| devnet (old) | `A1` | `C1` | mint `M1` |',
      '| devnet | `A2` | `C2` | mint `M2` |',
    ].join('\n');
    expect(parseDevnetDeployment(md)).toEqual({ programId: 'A2', configPda: 'C2', usdcMint: 'M2' });
  });

  it('pulls the mint from a cell with surrounding text', () => {
    const md = [
      '| Cluster | Program ID | Config PDA | USDC mint |',
      '|---|---|---|---|',
      '| devnet | `PROG` | `CFG` | Circle devnet USDC `MINT` |',
    ].join('\n');
    expect(parseDevnetDeployment(md).usdcMint).toBe('MINT');
  });
});

// -- env override / RPC resolution -----------------------------------------

describe('resolveEnvConfig', () => {
  const parsed = {
    programId: 'FileProgram',
    configPda: 'FileConfig',
    usdcMint: 'FileMint',
  };

  it('uses file values when no env overrides are set', () => {
    expect(resolveEnvConfig(parsed, {})).toEqual(parsed);
  });

  it('overrides each value from env', () => {
    const out = resolveEnvConfig(parsed, {
      PAYTRUTH_PROGRAM_ID: 'EnvProgram',
      PAYTRUTH_CONFIG_PDA: 'EnvConfig',
      PAYTRUTH_USDC_MINT: 'EnvMint',
    });
    expect(out).toEqual({ programId: 'EnvProgram', configPda: 'EnvConfig', usdcMint: 'EnvMint' });
  });

  it('resolves the full config with RPC default', () => {
    const env = { PAYTRUTH_PROGRAM_ID: 'EnvProgram', PAYTRUTH_CONFIG_PDA: 'EnvConfig', PAYTRUTH_USDC_MINT: 'EnvMint' };
    expect(resolveConfig(parsed, env)).toEqual({
      programId: 'EnvProgram',
      configPda: 'EnvConfig',
      usdcMint: 'EnvMint',
      rpcUrl: 'https://api.devnet.solana.com',
    });
  });

  it('honours PAYTRUTH_DEVNET_RPC', () => {
    const env = { PAYTRUTH_DEVNET_RPC: 'https://example.devnet.rpc' };
    expect(resolveConfig(parsed, env).rpcUrl).toBe('https://example.devnet.rpc');
  });
});

describe('resolveRpcUrl', () => {
  it('defaults to the public devnet endpoint', () => {
    expect(resolveRpcUrl({})).toBe('https://api.devnet.solana.com');
  });

  it('refuses any URL containing mainnet', () => {
    expect(() => resolveRpcUrl({ PAYTRUTH_DEVNET_RPC: 'https://api.mainnet-beta.solana.com' })).toThrow(
      /mainnet/i,
    );
    expect(() => resolveRpcUrl({ PAYTRUTH_DEVNET_RPC: 'https://MAINNET.example.com' })).toThrow(/mainnet/i);
  });
});

// -- genesis check ----------------------------------------------------------

describe('assertDevnetGenesis', () => {
  function conn(genesis: string): Connection {
    return { getGenesisHash: vi.fn().mockResolvedValue(genesis) } as unknown as Connection;
  }

  it('accepts the devnet genesis hash', async () => {
    await expect(assertDevnetGenesis(conn(DEVNET_GENESIS_HASH))).resolves.toBeUndefined();
  });

  it('aborts on a genesis mismatch', async () => {
    await expect(assertDevnetGenesis(conn('DifferentGenesisHash111'))).rejects.toThrow(/genesis/i);
  });
});

// -- keypair path safety ----------------------------------------------------

describe('isInsideRepo', () => {
  it('refuses a path inside the repo', () => {
    expect(isInsideRepo(join(repoRoot, 'sdk', 'secret.json'), repoRoot)).toBe(true);
  });

  it('accepts a path outside the repo', () => {
    expect(isInsideRepo(join('/home', 'box', '.config', 'solana', 'k.json'), repoRoot)).toBe(false);
  });

  it('does not treat a sibling with a shared prefix as inside', () => {
    expect(isInsideRepo(join(`${repoRoot}-other`, 'k.json'), repoRoot)).toBe(false);
  });
});

describe('loadKeypair', () => {
  it('refuses a keypair path inside the repo', () => {
    expect(() => loadKeypair(join(repoRoot, 'sdk', 'secret.json'), repoRoot)).toThrow(/inside the (git )?repo/i);
  });

  it('loads a keypair from a file outside the repo without exposing secret bytes', () => {
    const kp = Keypair.generate();
    const dir = join('/tmp', 'opencode');
    const path = join(dir, `paytruth-test-${Date.now()}.json`);
    // Write to /tmp (outside the repo) so loadKeypair can read it.
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify(Array.from(kp.secretKey)));
    try {
      const loaded = loadKeypair(path, repoRoot);
      expect(loaded.publicKey.equals(kp.publicKey)).toBe(true);
    } finally {
      rmSync(path, { force: true });
    }
  });
});

// -- amounts / needs --------------------------------------------------------

describe('usdcNeeds', () => {
  it('defaults: payer peak 2.50 USDC, merchant 0', () => {
    const needs = usdcNeeds(DEFAULT_AMOUNTS);
    expect(needs.payer).toBe(2_500_000n);
    expect(needs.merchant).toBe(0n);
  });

  it('derives payer need from step2Due + step5Pay', () => {
    const needs = usdcNeeds({ step2Due: 3_000_000n, step5Due: 1_000_000n, step5Pay: 4_000_000n, step6Due: 1_000_000n });
    expect(needs.payer).toBe(7_000_000n);
    expect(needs.merchant).toBe(0n);
  });
});

describe('SOL needs constants', () => {
  it('merchant >= 0.05 SOL and payer >= 0.01 SOL', () => {
    expect(DEVNET_SOL_NEEDS.merchant).toBe(50_000_000);
    expect(DEVNET_SOL_NEEDS.payer).toBe(10_000_000);
  });
});

// -- USDC wait logic --------------------------------------------------------

describe('resolveUsdcWait', () => {
  it('succeeds immediately when the balance is sufficient', async () => {
    const getBalance = vi.fn().mockResolvedValue(5_000_000n);
    const res = await resolveUsdcWait({ need: 2_500_000n, current: 5_000_000n, getBalance, pollMs: 10, timeoutMs: 1_000 });
    expect(res.ok).toBe(true);
    expect(getBalance).not.toHaveBeenCalled();
  });

  it('aborts with the exact shortfall when no wait is allowed', async () => {
    const getBalance = vi.fn();
    const res = await resolveUsdcWait({ need: 2_500_000n, current: 1_000_000n, getBalance, pollMs: 10, timeoutMs: 0 });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected failure');
    expect(res.shortfall).toBe(1_500_000n);
    expect(res.reason).toMatch(/1\.500000/);
    expect(getBalance).not.toHaveBeenCalled();
  });

  it('succeeds once a mocked balance rises within the bound', async () => {
    const values = [1_500_000n, 2_000_000n, 2_600_000n];
    let i = 0;
    const getBalance = vi.fn().mockImplementation(async () => values[Math.min(i++, values.length - 1)]);
    const res = await resolveUsdcWait({ need: 2_500_000n, current: 1_000_000n, getBalance, pollMs: 5, timeoutMs: 2_000 });
    expect(res.ok).toBe(true);
    expect(getBalance).toHaveBeenCalled();
  });

  it('times out after the bound when the balance never rises', async () => {
    const getBalance = vi.fn().mockResolvedValue(1_000_000n);
    const res = await resolveUsdcWait({ need: 2_500_000n, current: 1_000_000n, getBalance, pollMs: 5, timeoutMs: 30 });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected failure');
    expect(res.shortfall).toBe(1_500_000n);
  });
});

describe('ensureUsdcBalance', () => {
  it('reads the live balance and reports the shortfall', async () => {
    const getBalance = vi.fn().mockResolvedValue(1_000_000n);
    const res = await ensureUsdcBalance({
      need: 2_500_000n,
      waitSeconds: 0,
      getBalance,
      pollMs: 10,
    });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected failure');
    expect(res.shortfall).toBe(1_500_000n);
  });
});

// -- failed-tx meta.err mapping --------------------------------------------

describe('extractCustomCode / mapFailureMetaErr', () => {
  it('extracts Custom 6001 from an InstructionError meta.err', () => {
    const metaErr = { InstructionError: [0, { Custom: 6001 }] };
    expect(extractCustomCode(metaErr)).toBe(6001);
    const mapped = mapFailureMetaErr(metaErr);
    expect(mapped?.name).toBe('DuplicatePayment');
    expect(mapped?.code).toBe(6001);
  });

  it('maps Custom 6003 to InvoiceExpired', () => {
    const metaErr = { InstructionError: [0, { Custom: 6003 }] };
    expect(mapFailureMetaErr(metaErr)?.name).toBe('InvoiceExpired');
  });

  it('returns null for a successful tx (no error)', () => {
    expect(mapFailureMetaErr(null)).toBeNull();
  });
});
