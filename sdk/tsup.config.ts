import { defineConfig, type Options } from 'tsup';

const shared: Partial<Options> = {
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  external: [
    'react',
    '@solana/wallet-adapter-react',
    '@solana/wallet-adapter-base',
    '@solana/wallet-adapter-react-ui',
  ],
};

export default defineConfig([
  {
    ...shared,
    entry: { index: 'src/index.ts' },
    clean: true,
  },
  {
    ...shared,
    entry: { 'react/index': 'src/react/index.ts' },
    clean: false,
    onSuccess: 'node scripts/fix-use-client.mjs',
  },
]);
