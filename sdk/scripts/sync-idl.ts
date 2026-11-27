/**
 * Copies the Anchor Engineer's committed IDL artifacts (repo-root target/idl and
 * target/types, per HANDOFFS.md) into src/idl/. `--check` exits non-zero when
 * the SDK copy differs from the committed artifacts.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sdkRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(sdkRoot, '..');

export const IDL_FILES: Array<[string, string]> = [
  ['target/idl/paytruth.json', 'src/idl/paytruth.json'],
  ['target/types/paytruth.ts', 'src/idl/paytruth.ts'],
  ['target/types/paytruth_errors.ts', 'src/idl/paytruth_errors.ts'],
];

export function staleIdlFiles(): string[] {
  const stale: string[] = [];
  for (const [from, to] of IDL_FILES) {
    const src = resolve(repoRoot, from);
    if (!existsSync(src)) continue; // artifacts not present in this checkout
    const dst = resolve(sdkRoot, to);
    if (!existsSync(dst) || !readFileSync(src).equals(readFileSync(dst))) stale.push(to);
  }
  return stale;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const stale = staleIdlFiles();
    if (stale.length) {
      console.error(`IDL copy is stale vs target/: ${stale.join(', ')} (run pnpm sync:idl)`);
      process.exit(1);
    }
    console.log('src/idl matches target/idl + target/types.');
  } else {
    for (const [from, to] of IDL_FILES) {
      const src = resolve(repoRoot, from);
      if (existsSync(src)) writeFileSync(resolve(sdkRoot, to), readFileSync(src));
    }
    console.log('Copied target/idl + target/types into src/idl.');
  }
}
