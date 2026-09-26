import { createRequire } from "node:module";
import path from "node:path";
import type { NextConfig } from "next";

const require = createRequire(import.meta.url);
// snarkjs as Anon Aadhaar's CommonJS build resolves it (its Node build), swapped for the browser build.
const snarkjsBrowser = path.join(path.dirname(createRequire(require.resolve("@anon-aadhaar/core")).resolve("snarkjs")), "browser.esm.js");

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
        // Anon Aadhaar's CommonJS build requires snarkjs's Node build, which hangs in a web worker
        snarkjs$: snarkjsBrowser,
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
