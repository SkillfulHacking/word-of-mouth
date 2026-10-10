import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3"],
  // The circuit files never change for a given version, so phones can keep them.
  async headers() {
    return [{ source: "/zk/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] }];
  },
};

export default config;
