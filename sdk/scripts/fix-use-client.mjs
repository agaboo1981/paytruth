// Prepend the Next.js "use client" directive to the bundled React entry so
// client components resolve correctly. esbuild strips module directives while
// bundling, so we restore it as the literal first line of the output files.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'react');
for (const file of ['index.js', 'index.cjs']) {
  const path = join(dir, file);
  try {
    const src = readFileSync(path, 'utf8');
    if (!src.startsWith("'use client';") && !src.startsWith('"use client";')) {
      writeFileSync(path, `'use client';\n${src}`);
    }
  } catch {
    // dev build may not have emitted this file yet
  }
}
