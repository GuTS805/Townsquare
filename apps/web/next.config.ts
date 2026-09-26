import path from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@townsquare/core", "@townsquare/verifier", "@townsquare/math"],
  webpack(cfg, { isServer }) {
    if (!isServer) {
      // snarkjs and friends reference Node modules they never use in the browser
      cfg.resolve.fallback = { ...cfg.resolve.fallback, fs: false, readline: false, path: false, os: false, crypto: false };
      // the package lists its "node" build first, which web workers would otherwise pick up
      cfg.resolve.alias = {
        ...cfg.resolve.alias,
        "@semaphore-protocol/proof$": path.resolve("node_modules/@semaphore-protocol/proof/dist/index.browser.js"),
      };
    }
    return cfg;
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default config;
