const nextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    '@solana/wallet-adapter-base',
    '@solana/wallet-adapter-react',
    '@solana/wallet-adapter-react-ui',
  ],
  webpack: (config) => {
    // @anchor-lang/core's browser bundle references fs inside NodeWallet.local() (never called in the browser).
    config.resolve.fallback = { ...config.resolve.fallback, fs: false };
    return config;
  },
};

export default nextConfig;
