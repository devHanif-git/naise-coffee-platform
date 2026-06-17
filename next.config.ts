import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",
  // Pin the trace root to this project. Without this, Next walks up the tree,
  // finds a package-lock.json in a parent dir, and nests the standalone output
  // under that ancestor — so server.js ends up at a deep path instead of
  // .next/standalone/server.js, breaking the Azure startup command + CI copy.
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
