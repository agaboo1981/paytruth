/**
 * Mirror `sdk/src/**` into `../app/lib/paytruth/` for the Next.js app.
 *
 * - Copies every file verbatim, preserving the directory structure.
 * - `.ts`/`.tsx` files get a `// GENERATED ...` comment as the first line, or
 *   immediately after a leading `'use client'` directive (which must stay first).
 * - `.json` files are copied as-is.
 * - Writes `app/lib/paytruth/README.md` explaining it is generated.
 * - Deletes stale files under the destination that no longer exist in source.
 *
 * `checkAppSync()` compares the expected copy with what is on disk and returns
 * the list of differences (empty when in sync), used by `pnpm check:app-sync`.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const GENERATED_MARKER = '// GENERATED from sdk/src by `pnpm sync:app` — do not edit here.';

const APP_LIB_README = `# app/lib/paytruth (GENERATED)

This directory is **generated** from \`sdk/src/**\` by \`pnpm sync:app\` (run from \`sdk/\`).
Do not edit files here directly — edit \`sdk/src/**\` and re-run the sync.

The app must declare these runtime dependencies (they are the SDK's deps):

- \`@anchor-lang/core@^1.2.2\`
- \`@solana/spl-token@^0.4.15\`
- \`bn.js\`

Import from the app as:

\`\`\`ts
import { paytruthSdk } from '@/lib/paytruth';
import { useInvoice, PaytruthWalletProvider } from '@/lib/paytruth/react';
\`\`\`

Check that this mirror is up to date with \`pnpm check:app-sync\` (from \`sdk/\`).
`;

export interface SyncPaths {
  srcDir: string;
  destDir: string;
}

export function defaultPaths(): SyncPaths {
  const here = dirname(fileURLToPath(import.meta.url));
  const sdkRoot = join(here, '..');
  return {
    srcDir: join(sdkRoot, 'src'),
    destDir: join(sdkRoot, '..', 'app', 'lib', 'paytruth'),
  };
}

function walk(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walk(full, base));
    } else {
      out.push(relative(base, full));
    }
  }
  return out;
}

function isSourceFile(relPath: string): boolean {
  return relPath.endsWith('.ts') || relPath.endsWith('.tsx') || relPath.endsWith('.json');
}

function transformSource(relPath: string, content: string): string {
  if (relPath.endsWith('.json')) return content;
  if (!(relPath.endsWith('.ts') || relPath.endsWith('.tsx'))) return content;

  const lines = content.split('\n');
  let insertAt = 0;
  // Preserve a leading 'use client' (or "use client") directive as line 1.
  const first = lines[0]?.trim();
  if (first === "'use client';" || first === '"use client";' || first === "'use client'" || first === '"use client"') {
    insertAt = 1;
  }
  lines.splice(insertAt, 0, GENERATED_MARKER);
  return lines.join('\n');
}

/** Compute the full expected destination file map (relative path -> content). */
export function computeExpectedFiles(paths: SyncPaths = defaultPaths()): Map<string, string> {
  const files = new Map<string, string>();
  for (const rel of walk(paths.srcDir)) {
    if (!isSourceFile(rel)) continue;
    const src = readFileSync(join(paths.srcDir, rel), 'utf8');
    files.set(rel.split(sep).join('/'), transformSource(rel, src));
  }
  return files;
}

/** Perform the mirror copy. Returns the list of written and deleted paths. */
export function syncToApp(paths: SyncPaths = defaultPaths()): { written: string[]; deleted: string[] } {
  const expected = computeExpectedFiles(paths);
  mkdirSync(paths.destDir, { recursive: true });

  const written: string[] = [];
  for (const [rel, content] of expected) {
    const dest = join(paths.destDir, rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, content);
    written.push(rel);
  }

  // README
  writeFileSync(join(paths.destDir, 'README.md'), APP_LIB_README);

  // Delete stale files (keep README.md, keep .gitkeep).
  const deleted: string[] = [];
  const expectedRels = new Set(expected.keys());
  for (const rel of walk(paths.destDir)) {
    const norm = rel.split(sep).join('/');
    if (norm === 'README.md' || norm === '.gitkeep') continue;
    if (!expectedRels.has(norm)) {
      rmSync(join(paths.destDir, rel));
      deleted.push(norm);
    }
  }
  // Remove now-empty directories.
  pruneEmptyDirs(paths.destDir, paths.destDir);

  return { written, deleted };
}

function pruneEmptyDirs(dir: string, root: string): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      pruneEmptyDirs(full, root);
      if (readdirSync(full).length === 0 && full !== root) rmSync(full, { recursive: true });
    }
  }
}

export interface SyncDiff {
  missing: string[];
  stale: string[];
  modified: string[];
  readmeOutdated: boolean;
}

/** Compare the expected mirror against what is on disk. */
export function checkAppSync(paths: SyncPaths = defaultPaths()): SyncDiff {
  const expected = computeExpectedFiles(paths);
  const missing: string[] = [];
  const modified: string[] = [];

  for (const [rel, content] of expected) {
    const dest = join(paths.destDir, rel);
    if (!existsSync(dest)) {
      missing.push(rel);
      continue;
    }
    if (readFileSync(dest, 'utf8') !== content) modified.push(rel);
  }

  const stale: string[] = [];
  if (existsSync(paths.destDir)) {
    const expectedRels = new Set(expected.keys());
    for (const rel of walk(paths.destDir)) {
      const norm = rel.split(sep).join('/');
      if (norm === 'README.md' || norm === '.gitkeep') continue;
      if (!expectedRels.has(norm)) stale.push(norm);
    }
  }

  let readmeOutdated = false;
  const readmePath = join(paths.destDir, 'README.md');
  if (!existsSync(readmePath) || readFileSync(readmePath, 'utf8') !== APP_LIB_README) {
    readmeOutdated = true;
  }

  return { missing, stale, modified, readmeOutdated };
}

export function isInSync(diff: SyncDiff): boolean {
  return (
    diff.missing.length === 0 &&
    diff.stale.length === 0 &&
    diff.modified.length === 0 &&
    !diff.readmeOutdated
  );
}

export { GENERATED_MARKER, APP_LIB_README };

// CLI
function main(): void {
  const cmd = process.argv[2];
  if (cmd === '--check') {
    const diff = checkAppSync();
    if (isInSync(diff)) {
      // eslint-disable-next-line no-console
      console.log('app/lib/paytruth is in sync with sdk/src.');
      return;
    }
    // eslint-disable-next-line no-console
    console.error('app/lib/paytruth is STALE. Run `pnpm sync:app` from sdk/.');
    if (diff.missing.length) console.error('  missing:', diff.missing.join(', '));
    if (diff.stale.length) console.error('  stale:', diff.stale.join(', '));
    if (diff.modified.length) console.error('  modified:', diff.modified.join(', '));
    if (diff.readmeOutdated) console.error('  README.md is outdated');
    process.exit(1);
  }

  const { written, deleted } = syncToApp();
  // eslint-disable-next-line no-console
  console.log(`synced ${written.length} file(s) to app/lib/paytruth, removed ${deleted.length} stale file(s).`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
