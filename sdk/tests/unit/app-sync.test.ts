import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  GENERATED_MARKER,
  computeExpectedFiles,
  checkAppSync,
  isInSync,
  syncToApp,
  defaultPaths,
} from '../../scripts/sync-to-app';

describe('sync-to-app', () => {
  it('app/lib/paytruth is in sync with sdk/src (run pnpm sync:app after edits)', () => {
    const diff = checkAppSync();
    expect(isInSync(diff), JSON.stringify(diff)).toBe(true);
  });

  it('prefixes .ts files with the generated marker', () => {
    const expected = computeExpectedFiles();
    const client = expected.get('client.ts');
    expect(client).toBeDefined();
    expect(client!.startsWith(GENERATED_MARKER)).toBe(true);
  });

  it('keeps a leading use client directive first, marker after it', () => {
    const expected = computeExpectedFiles();
    const hooks = expected.get('react/hooks.ts');
    expect(hooks).toBeDefined();
    const lines = hooks!.split('\n');
    expect(lines[0]).toBe("'use client';");
    expect(lines[1]).toBe(GENERATED_MARKER);
  });

  it('copies JSON as-is (no marker)', () => {
    const expected = computeExpectedFiles();
    const json = expected.get('idl/paytruth.json');
    expect(json).toBeDefined();
    expect(json!.startsWith(GENERATED_MARKER)).toBe(false);
    expect(json!.trimStart().startsWith('{')).toBe(true);
    expect(expected.has('idl/paytruth.spec.json')).toBe(false);
  });

  it('detects a stale copy via the same comparison', () => {
    const paths = defaultPaths();
    // Write a temporary extra file into a scratch subdir to simulate staleness.
    const scratchDir = join(paths.destDir, '__sync_test_tmp__');
    mkdirSync(scratchDir, { recursive: true });
    const scratchFile = join(scratchDir, 'stale.ts');
    writeFileSync(scratchFile, 'export const x = 1;\n');
    try {
      const diff = checkAppSync();
      expect(isInSync(diff)).toBe(false);
      expect(diff.stale).toContain('__sync_test_tmp__/stale.ts');
    } finally {
      rmSync(scratchDir, { recursive: true, force: true });
    }
    expect(isInSync(checkAppSync())).toBe(true);
  });

  it('syncToApp writes the README into the destination', () => {
    syncToApp();
    const readme = readFileSync(join(defaultPaths().destDir, 'README.md'), 'utf8');
    expect(readme.toLowerCase()).toContain('generated');
  });
});
