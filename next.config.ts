import type { NextConfig } from "next";
import path from "node:path";

const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
  : undefined;

const nextConfig: NextConfig = {
  output: "standalone",
  // Pin the trace root to this project. Without this, Next walks up the tree,
  // finds a package-lock.json in a parent dir, and nests the standalone output
  // under that ancestor — so server.js ends up at a deep path instead of
  // .next/standalone/server.js, breaking the Azure startup command + CI copy.
  outputFileTracingRoot: path.join(__dirname),
  images: {
    remotePatterns: supabaseHost
      ? [{ protocol: "https", hostname: supabaseHost, pathname: "/storage/v1/**" }]
      : [],
  },
};

export default nextConfig;
