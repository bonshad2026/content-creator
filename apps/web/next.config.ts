import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @cc/core ships TypeScript source.
  transpilePackages: ["@cc/core"],
  // Native / Node-only packages stay out of the bundle.
  serverExternalPackages: ["sharp", "pg", "bullmq", "ioredis"],
};

export default nextConfig;
