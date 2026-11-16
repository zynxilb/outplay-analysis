import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["*.trycloudflare.com"],

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Enable cross-origin isolation so Stockfish WASM can use
          // SharedArrayBuffer and run multi-threaded.
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          // "credentialless" is more permissive than "require-corp":
          // it does not block cross-origin resources (Google Fonts,
          // analytics) that lack CORP headers.
          { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
        ],
      },
      {
        source: "/engine/:path*",
        headers: [
          // Explicit correct MIME for WASM
          { key: "Content-Type", value: "application/wasm" },
        ],
      },
    ];
  },
};

export default nextConfig;
