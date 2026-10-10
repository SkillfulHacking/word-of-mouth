import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  // The file tracer follows runtime-built paths (the image folder) widely; keep tests and scripts out of the build and the Docker image.
  outputFileTracingExcludes: { "*": ["**/*.test.ts", "scripts/**", "docs/**", "session-upload/**"] },
  serverExternalPackages: ["better-sqlite3"],
  // The circuit files never change for a given version, so phones can keep them.
  async headers() {
    return [{ source: "/zk/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] }];
  },
};

export default config;
