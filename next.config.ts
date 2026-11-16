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
          // it does not block cross-origin resources (Google Fonts)
          // that lack CORP headers.
          { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
        ],
      },
      {
        // Only .wasm files get the wasm MIME type. JS files must keep
        // application/javascript or the Worker will refuse to load.
        source: "/engine/:file*.wasm",
        headers: [
          { key: "Content-Type", value: "application/wasm" },
        ],
      },
    ];
  },
};

export default nextConfig;
