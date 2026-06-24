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
  experimental: {
    serverActions: {
      // Behind Cloudflare/reverse proxy the forwarded host differs from the
      // request Origin, so Next's CSRF check rejects Server Actions with 403.
      // Allow the production domain (and any subdomain) so uploads/toggles work.
      allowedOrigins: ["naisecoffee.utemride.my", "*.utemride.my"],
      // Product image uploads run through a Server Action; raise the default
      // 1 MB body cap to match the uploader's 5 MB limit (actions.ts).
      bodySizeLimit: "5mb",
    },
  },
};

export default nextConfig;
