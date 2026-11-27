import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

type Theme = 'dark' | 'light';

type ContrastPair = {
  label: string;
  foreground: string;
  background: string;
  minimum: number;
};

const scriptDir = dirname(fileURLToPath(import.meta.url));
const tokenPath = join(scriptDir, '..', 'styles', 'tokens.css');
const outputPath = join(scriptDir, '..', 'styles', 'CONTRAST.md');

const css = readFileSync(tokenPath, 'utf8');

function parseBlock(selector: RegExp): Record<string, string> {
  const block = css.match(selector)?.[1];
  if (!block) {
    throw new Error('Missing token block in styles/tokens.css');
  }

  const result: Record<string, string> = {};
  const declaration = /--([\w-]+)\s*:\s*(#[0-9a-fA-F]{6});/g;
  for (const match of block.matchAll(declaration)) {
    result[match[1]] = match[2];
  }
  return result;
}

const themes: Record<Theme, Record<string, string>> = {
  dark: parseBlock(/:root,\s*\.dark\s*\{([\s\S]*?)\}/),
  light: parseBlock(/\.light\s*\{([\s\S]*?)\}/),
};

function channel(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : Math.pow((normalized + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const clean = hex.replace('#', '');
  const red = channel(parseInt(clean.slice(0, 2), 16));
  const green = channel(parseInt(clean.slice(2, 4), 16));
  const blue = channel(parseInt(clean.slice(4, 6), 16));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(foreground: string, background: string): number {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

const bodyPairs: ContrastPair[] = [
  { label: 'Body text / canvas', foreground: 'fg', background: 'bg', minimum: 4.5 },
  { label: 'Body text / panel', foreground: 'fg', background: 'surface', minimum: 4.5 },
  { label: 'Body text / raised panel', foreground: 'fg', background: 'surface-2', minimum: 4.5 },
  { label: 'Muted text / canvas', foreground: 'muted', background: 'bg', minimum: 4.5 },
  { label: 'Muted text / panel', foreground: 'muted', background: 'surface', minimum: 4.5 },
  { label: 'Muted text / raised panel', foreground: 'muted', background: 'surface-2', minimum: 4.5 },
  { label: 'Primary button label', foreground: 'accent-fg', background: 'accent', minimum: 4.5 },
  { label: 'Success button label', foreground: 'success-fg', background: 'success', minimum: 4.5 },
  { label: 'Warning button label', foreground: 'warning-fg', background: 'warning', minimum: 4.5 },
  { label: 'Danger button label', foreground: 'danger-fg', background: 'danger', minimum: 4.5 },
  { label: 'Pending button label', foreground: 'pending-fg', background: 'pending', minimum: 4.5 },
];

const uiPairs: ContrastPair[] = [
  { label: 'Border / canvas', foreground: 'border', background: 'bg', minimum: 3 },
  { label: 'Border / panel', foreground: 'border', background: 'surface', minimum: 3 },
  { label: 'Focus ring / canvas', foreground: 'accent', background: 'bg', minimum: 3 },
  { label: 'Focus ring / panel', foreground: 'accent', background: 'surface', minimum: 3 },
  { label: 'Success text / panel', foreground: 'success', background: 'surface', minimum: 3 },
  { label: 'Warning text / panel', foreground: 'warning', background: 'surface', minimum: 3 },
  { label: 'Danger text / panel', foreground: 'danger', background: 'surface', minimum: 3 },
  { label: 'Pending text / panel', foreground: 'pending', background: 'surface', minimum: 3 },
  { label: 'Success text / raised panel', foreground: 'success', background: 'surface-2', minimum: 3 },
  { label: 'Warning text / raised panel', foreground: 'warning', background: 'surface-2', minimum: 3 },
  { label: 'Danger text / raised panel', foreground: 'danger', background: 'surface-2', minimum: 3 },
  { label: 'Pending text / raised panel', foreground: 'pending', background: 'surface-2', minimum: 3 },
];

const pairs = [...bodyPairs, ...uiPairs];
const rows: string[] = [];
let failed = 0;

for (const theme of ['dark', 'light'] as const) {
  for (const pair of pairs) {
    const foreground = themes[theme][pair.foreground];
    const background = themes[theme][pair.background];
    if (!foreground || !background) {
      throw new Error(`Missing ${pair.foreground}/${pair.background} in ${theme} tokens`);
    }

    const ratio = contrastRatio(foreground, background);
    const rounded = Math.round(ratio * 100) / 100;
    const passesBody = ratio >= 4.5;
    const passesUi = ratio >= 3;
    const passes = ratio >= pair.minimum;
    if (!passes) failed += 1;

    rows.push(
      `| ${theme} | ${pair.label} | ${pair.foreground} ${foreground} / ${pair.background} ${background} | ${rounded.toFixed(2)}:1 | ${pair.minimum.toFixed(1)}:1 | ${passesBody ? 'yes' : 'no'} | ${passesUi ? 'yes' : 'no'} | ${passes ? 'PASS' : 'FAIL'} |`,
    );
  }
}

const markdown = [
  '# Token contrast',
  '',
  'Generated by `npm run contrast` from `styles/tokens.css`. Do not edit by hand.',
  '',
  'Ratios use the WCAG relative-luminance formula with sRGB linearization. Body text requires 4.5:1; large text and meaningful UI require 3:1.',
  '',
  '| Theme | Pair | Colors | Ratio | Required | AA body (4.5) | AA large/UI (3.0) | Result |',
  '| --- | --- | --- | ---: | ---: | :---: | :---: | :---: |',
  ...rows,
  '',
  `${pairs.length * 2} pairs checked. ${failed === 0 ? 'All required pairs pass.' : `${failed} required pair(s) failed.`}`,
  '',
].join('\n');

writeFileSync(outputPath, markdown, 'utf8');

if (failed > 0) {
  console.error(`Contrast check failed: ${failed} pair(s) below the required ratio.`);
  process.exitCode = 1;
} else {
  console.log(`Contrast check passed: wrote ${pairs.length * 2} verified pairs to styles/CONTRAST.md.`);
}
