import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Avoid wrong workspace root when a package-lock exists above this repo (e.g. ~/package-lock.json)
  outputFileTracingRoot: process.cwd(),
  /**
   * Dev-only: allow loading /_next/* (bundles, HMR) when you open the app via
   * your LAN IP (e.g. http://192.168.1.x:3000 on your phone). Without this,
   * scripts are blocked and the page looks loaded but buttons don’t work.
   * Optional extra hosts: NEXT_DEV_ALLOWED_ORIGINS=192.168.1.5,mybox.local
   */
  allowedDevOrigins: [
    "*.*.*.*",
    ...(process.env.NEXT_DEV_ALLOWED_ORIGINS?.split(",")
      .map((h) => h.trim())
      .filter(Boolean) ?? []),
  ],
  webpack: (config, { isServer, webpack }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        crypto: false,
      };
    }

    config.experiments = {
      ...config.experiments,
      topLevelAwait: true,
    };

    config.plugins.push(
      new webpack.IgnorePlugin({
        resourceRegExp:
          /^(@metamask\/connect-evm|porto|porto\/internal|@farcaster\/mini-app-solana)$/,
      }),
    );

    return config;
  },
};

export default nextConfig;
